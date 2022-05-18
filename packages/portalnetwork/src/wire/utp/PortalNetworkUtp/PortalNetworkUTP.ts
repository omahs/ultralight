import { Discv5 } from '@chainsafe/discv5'
import { Debugger } from 'debug'
import { EventEmitter } from 'ws'
import { bufferToPacket, PacketType, randUint16, UtpSocket } from '..'
import { SubprotocolIds } from '../../..'
import { PortalNetwork } from '../../..'
import { BasicUtp } from '../Protocol/BasicUtp'
import { ContentRequest } from './ContentRequest'
import PacketHandlers from './PacketHandlers'

type UtpSocketKey = string

export enum RequestCode {
  FOUNDCONTENT_WRITE = 0,
  FINDCONTENT_READ = 1,
  OFFER_WRITE = 2,
  ACCEPT_READ = 3,
}

function createSocketKey(remoteAddr: string, sndId: number, rcvId: number) {
  return `${remoteAddr.slice(0, 5)}-${sndId}-${rcvId}`
}
export class PortalNetworkUTP extends EventEmitter {
  portal: PortalNetwork
  client: Discv5
  protocol: BasicUtp
  packetHandlers: PacketHandlers
  openContentRequests: Record<UtpSocketKey, ContentRequest<any>>
  logger: Debugger
  working: boolean

  constructor(portal: PortalNetwork) {
    super()
    this.portal = portal
    this.client = portal.client
    this.protocol = new BasicUtp((peerId: string, msg: Buffer, protocolId: SubprotocolIds) =>
      this.sendPortalNetworkMessage(peerId, msg, protocolId)
    )
    this.logger = portal.logger.extend(`uTP`)
    this.openContentRequests = {}
    this.working = false
    this.packetHandlers = new PacketHandlers(this)
  }

  createUtpSocket(
    requestCode: RequestCode,
    peerId: string,
    sndId: number,
    rcvId: number,
    content?: Uint8Array
  ): UtpSocket | undefined {
    let socket: UtpSocket
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        socket = this.protocol.createNewSocket(
          peerId,
          sndId,
          rcvId,
          randUint16(),
          0,
          1,
          undefined,
          'write',
          this.logger,
          content
        )
        return socket
      case RequestCode.FINDCONTENT_READ:
        socket = this.protocol.createNewSocket(
          peerId,
          sndId,
          rcvId,
          0,
          randUint16(),
          undefined,
          1,
          'read',
          this.logger
        )
        return socket
      case RequestCode.OFFER_WRITE:
        socket = this.protocol.createNewSocket(
          peerId,
          sndId,
          rcvId,
          1,
          randUint16(),
          undefined,
          1,
          'write',
          this.logger,
          content
        )
        return socket
      case RequestCode.ACCEPT_READ:
        socket = this.protocol.createNewSocket(
          peerId,
          sndId,
          rcvId,
          randUint16(),
          0,
          1,
          undefined,
          'read',
          this.logger
        )
        return socket
    }
  }

  async sendPortalNetworkMessage(
    peerId: string,
    msg: Buffer,
    protocolId: SubprotocolIds
  ): Promise<void> {
    await this.portal.sendPortalNetworkMessage(peerId, msg, protocolId, true)
  }

  /**
   * Handles a request from Portal Network Client for uTP
   * @typedef T the type of contentKeys (e.g. <HistoryNetworkContentKey>)
   * @param deserializer ssz method to deserialize content keys
   * @param contentKeys array of contentKeys for requested content
   * @param peerId Portal Network peer involved in transfer
   * @param connectionId Random Uint16 from Portal Network FOUNDCONTENT or ACCEPT talkResp
   * @param content SENDER: requested content from db
   */

  async handleContentRequest<T>(
    deserializer: (serialized: Uint8Array) => any,
    contentKeys: Uint8Array[],
    peerId: string,
    connectionId: number,
    requestCode: RequestCode,
    contents?: Uint8Array[]
  ): Promise<void> {
    let sndId: number
    let rcvId: number
    let socket: UtpSocket
    let socketKey: string
    let newRequest: ContentRequest<T>
    let sockets: UtpSocket[]
    const _contentKeys = contentKeys.map((k) => {
      return deserializer(Uint8Array.from(k)).value
    }) as T[]
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        if (contents === undefined) {
          throw new Error('No contents to write')
        }
        sndId = connectionId
        rcvId = connectionId + 1
        socket = this.createUtpSocket(requestCode, peerId, sndId, rcvId, contents[0])!
        if (socket === undefined) {
          throw new Error('Error in Socket Creation')
        }
        socketKey = createSocketKey(peerId, sndId, rcvId)
        newRequest = new ContentRequest<T>(requestCode, [_contentKeys[0]], [socket], socketKey, [
          undefined,
        ])
        if (this.openContentRequests[socketKey]) {
          this.logger(`Request already Open`)
        } else {
          this.openContentRequests[socketKey] = newRequest
          this.logger(`Opening request with key: ${socketKey}`)
          await newRequest.init()
        }
        break
      case RequestCode.FINDCONTENT_READ:
        sndId = connectionId + 1
        rcvId = connectionId
        socket = this.createUtpSocket(requestCode, peerId, sndId, rcvId)!
        if (socket === undefined) {
          throw new Error('Error in Socket Creation')
        }
        socketKey = createSocketKey(peerId, sndId, rcvId)
        newRequest = new ContentRequest(requestCode, _contentKeys, [socket], socketKey, [undefined])
        if (this.openContentRequests[socketKey]) {
          this.logger(`Request already Open`)
        } else {
          this.openContentRequests[socketKey] = newRequest
          this.logger(`Opening request with key: ${socketKey}`)
          await newRequest.init()
        }
        break
      case RequestCode.OFFER_WRITE:
        if (contents === undefined) {
          throw new Error('No contents to write')
        }
        sndId = connectionId + 1
        rcvId = connectionId
        socketKey = createSocketKey(peerId, sndId, rcvId)
        sockets = contents.map((content) => {
          return this.createUtpSocket(requestCode, peerId, sndId, rcvId, content)!
        })

        newRequest = new ContentRequest(requestCode, _contentKeys, sockets, socketKey, contents)

        if (this.openContentRequests[socketKey]) {
          this.logger(`Request already Open`)
        } else {
          this.openContentRequests[socketKey] = newRequest
          this.logger(`Opening request with key: ${socketKey}`)
          await newRequest.init()
        }

        break
      case RequestCode.ACCEPT_READ:
        sndId = connectionId
        rcvId = connectionId + 1
        socketKey = createSocketKey(peerId, sndId, rcvId)
        if (this.openContentRequests[socketKey]) {
          this.logger(`Request already Open`)
        } else {
          this.logger(`Opening request with key: ${socketKey}`)
          sockets = contentKeys.map(() => {
            return this.createUtpSocket(requestCode, peerId, sndId, rcvId)!
          })
          newRequest = new ContentRequest(requestCode, _contentKeys, sockets, socketKey, [])
          this.openContentRequests[socketKey] = newRequest
          await newRequest.init()
        }
        break
    }
  }

  getRequestKeyFromPortalMessage(packetBuffer: Buffer, peerId: string): string {
    const packet = bufferToPacket(packetBuffer)
    const connId = packet.header.connectionId
    const idA = connId + 1
    const idB = connId - 1
    const keyA = createSocketKey(peerId, connId, idA)
    const keyB = createSocketKey(peerId, idA, connId)
    const keyC = createSocketKey(peerId, connId, idB)
    const keyD = createSocketKey(peerId, idB, connId)
    if (this.openContentRequests[keyA] !== undefined) {
      return keyA
    } else if (this.openContentRequests[keyB] !== undefined) {
      return keyB
    } else if (this.openContentRequests[keyC] !== undefined) {
      return keyC
    } else if (this.openContentRequests[keyD] !== undefined) {
      return keyD
    } else {
      this.logger(`Cannot Find Open Request for socketKey ${keyA} or ${keyB} or ${keyC} or ${keyD}`)
      return ''
    }
  }

  async handleUtpPacket(packetBuffer: Buffer, srcId: string): Promise<void> {
    const requestKey = this.getRequestKeyFromPortalMessage(packetBuffer, srcId)
    const request = this.openContentRequests[requestKey]
    const packet = bufferToPacket(packetBuffer)
    switch (packet.header.pType) {
      case PacketType.ST_SYN:
        this.logger(
          `SYN Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleSynPacket(request, packet))
        break
      case PacketType.ST_DATA:
        this.logger(
          `DATA Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleDataPacket(request, packet))
        break
      case PacketType.ST_STATE:
        this.logger(
          `STATE Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleStatePacket(request, packet))
        break
      case PacketType.ST_RESET:
        this.logger(
          `RESET Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleResetPacket(request))
        break
      case PacketType.ST_FIN:
        this.logger(
          `FIN Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleFinPacket(request, packet))
        break
      default:
        this.logger(`Unknown Packet Type ${packet.header.pType}`)
    }
  }
}

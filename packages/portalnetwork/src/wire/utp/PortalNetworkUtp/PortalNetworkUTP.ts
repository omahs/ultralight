import { NodeId } from '@chainsafe/discv5'
import { Type } from '@chainsafe/ssz'
import StrictEventEmitter from 'strict-event-emitter-types/types/src'
import { EventEmitter } from 'ws'
import { bufferToPacket, PacketType, randUint16, UtpSocket } from '..'
import { SubprotocolIds } from '../../..'
// import { BasicUtp } from '../Protocol/BasicUtp'
import { ContentRequest } from './ContentRequest'
import PacketHandlers from './PacketHandlers'

export type UtpSocketKey = string
export interface IUtpEvents {
  ContentReady: (chainId: number, blockHash: string, content: Uint8Array) => Promise<void>
  handleContentRequest: (
    type: Type<any>,
    contentKeys: Uint8Array[],
    peerId: string,
    connectionId: number,
    requestCode: RequestCode,
    contents?: Uint8Array[]
  ) => Promise<void>
  send: (
    dstId: NodeId,
    payload: Buffer,
    protocolId: SubprotocolIds,
    utpMessage?: boolean
  ) => Promise<void>
  log: (message: string, extension?: string) => void
}
export type UtpEventEmitter = StrictEventEmitter<EventEmitter, IUtpEvents>

export enum RequestCode {
  FOUNDCONTENT_WRITE = 0,
  FINDCONTENT_READ = 1,
  OFFER_WRITE = 2,
  ACCEPT_READ = 3,
}

function createSocketKey(remoteAddr: string, sndId: number, rcvId: number) {
  return `${remoteAddr.slice(0, 5)}-${sndId}-${rcvId}`
}
export class PortalNetworkUTP extends (EventEmitter as { new (): UtpEventEmitter }) {
  // protocol: BasicUtp
  packetHandlers: PacketHandlers
  openContentRequests: Record<UtpSocketKey, ContentRequest>
  working: boolean

  constructor() {
    // eslint-disable-next-line constructor-super
    super()
    // this.protocol = new BasicUtp(this.sendPortalNetworkMessage, this.log)
    this.openContentRequests = {}
    this.working = false
    this.packetHandlers = new PacketHandlers(
      this.log,
      this.sendPortalNetworkMessage,
      (chainId: number, blockHash: string, content: Uint8Array) =>
        this.emit('ContentReady', chainId, blockHash, content)
    )
    this.on('handleContentRequest', this.handleContentRequest)
  }

  log(message: string, extension?: string) {
    this.emit('log', message, extension)
  }

  async createUtpSocket(
    requestCode: RequestCode,
    peerId: string,
    sndId: number,
    rcvId: number,
    content?: Uint8Array
  ): Promise<UtpSocket> {
    let socket: UtpSocket
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        socket = await UtpSocket.createNewSocket(
          peerId,
          sndId,
          rcvId,
          randUint16(),
          0,
          1,
          undefined,
          'write',
          this.log,
          this.sendPortalNetworkMessage,
          content
        )
        return socket
      case RequestCode.FINDCONTENT_READ:
        socket = await UtpSocket.createNewSocket(
          peerId,
          sndId,
          rcvId,
          0,
          randUint16(),
          undefined,
          1,
          'read',
          this.log,
          this.sendPortalNetworkMessage
        )
        return socket
      case RequestCode.OFFER_WRITE:
        socket = await UtpSocket.createNewSocket(
          peerId,
          sndId,
          rcvId,
          1,
          randUint16(),
          undefined,
          1,
          'write',
          this.log,
          this.sendPortalNetworkMessage,
          content
        )
        return socket
      case RequestCode.ACCEPT_READ:
        socket = await UtpSocket.createNewSocket(
          peerId,
          sndId,
          rcvId,
          randUint16(),
          0,
          1,
          undefined,
          'read',
          this.log,
          this.sendPortalNetworkMessage
        )
        return socket
      default:
        throw new Error('Socket Error')
    }
  }

  sendPortalNetworkMessage(peerId: string, msg: Buffer, protocolId: SubprotocolIds): void {
    this.emit('send', peerId, msg, protocolId, true)
  }

  /**
   * Handles a request from Portal Network Client for uTP
   * @param type ssz type of content keys
   * @param contentKeys array of contentKeys for requested content
   * @param peerId Portal Network peer involved in transfer
   * @param connectionId Random Uint16 from Portal Network FOUNDCONTENT or ACCEPT talkResp
   * @param contents SENDER: requested content from db
   */

  async handleContentRequest(
    type: Type<any>,
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
    let newRequest: ContentRequest
    let sockets: UtpSocket[]
    const _contentKeys = contentKeys.map((k) => {
      return type.deserialize(Uint8Array.from(k)).value
    }) as { chainId: number; blockHash: Uint8Array }[]
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        if (contents === undefined) {
          throw new Error('No contents to write')
        }
        sndId = connectionId
        rcvId = connectionId + 1
        try {
          socket = await this.createUtpSocket(requestCode, peerId, sndId, rcvId, contents[0])
          socketKey = createSocketKey(peerId, sndId, rcvId)
          newRequest = new ContentRequest(requestCode, [_contentKeys[0]], [socket], socketKey, [
            undefined,
          ])
          if (this.openContentRequests[socketKey]) {
            throw new Error(`Request already Open`)
          } else {
            this.openContentRequests[socketKey] = newRequest
            await newRequest.init()
          }
        } catch {
          throw new Error('Error in Socket Creation')
        }
        break
      case RequestCode.FINDCONTENT_READ:
        sndId = connectionId + 1
        rcvId = connectionId
        socket = await this.createUtpSocket(requestCode, peerId, sndId, rcvId)!
        if (socket === undefined) {
          throw new Error('Error in Socket Creation')
        }
        socketKey = createSocketKey(peerId, sndId, rcvId)
        newRequest = new ContentRequest(requestCode, _contentKeys, [socket], socketKey, [undefined])
        if (this.openContentRequests[socketKey]) {
          throw new Error(`Request already Open`)
        } else {
          this.openContentRequests[socketKey] = newRequest
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
        sockets = []
        contents.forEach(async (content) => {
          const s: UtpSocket = await this.createUtpSocket(
            requestCode,
            peerId,
            sndId,
            rcvId,
            content
          )
          sockets.push(s)
        })
        newRequest = new ContentRequest(requestCode, _contentKeys, sockets, socketKey, contents)
        if (this.openContentRequests[socketKey]) {
          throw new Error(`Request already Open`)
        } else {
          this.openContentRequests[socketKey] = newRequest
          await newRequest.init()
        }

        break
      case RequestCode.ACCEPT_READ:
        sndId = connectionId
        rcvId = connectionId + 1
        socketKey = createSocketKey(peerId, sndId, rcvId)
        if (this.openContentRequests[socketKey]) {
          throw new Error(`Request already Open`)
        } else {
          sockets = []
          contentKeys.forEach(async () => {
            const s = await this.createUtpSocket(requestCode, peerId, sndId, rcvId)
            sockets.push(s)
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
      throw new Error(
        `Cannot Find Open Request for socketKey ${keyA} or ${keyB} or ${keyC} or ${keyD}`
      )
    }
  }

  async handleUtpPacket(packetBuffer: Buffer, srcId: string): Promise<void> {
    const requestKey = this.getRequestKeyFromPortalMessage(packetBuffer, srcId)
    const request = this.openContentRequests[requestKey]
    const packet = bufferToPacket(packetBuffer)
    switch (packet.header.pType) {
      case PacketType.ST_SYN:
        this.emit(
          'log',
          `SYN Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`,
          'uTP'
        )
        requestKey && (await this.packetHandlers.handleSynPacket(request, packet))
        break
      case PacketType.ST_DATA:
        this.emit(
          'log',
          `DATA Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleDataPacket(request, packet))
        break
      case PacketType.ST_STATE:
        this.emit(
          'log',
          `STATE Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleStatePacket(request, packet))
        break
      case PacketType.ST_RESET:
        this.emit(
          'log',
          `RESET Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        delete this.openContentRequests[requestKey]
        break
      case PacketType.ST_FIN:
        this.emit(
          'log',
          `FIN Packet received seqNr: ${packet.header.seqNr} ackNr: ${packet.header.ackNr}`
        )
        requestKey && (await this.packetHandlers.handleFinPacket(request, packet))
        break
      default:
        throw new Error(`Unknown Packet Type ${packet.header.pType}`)
    }
  }
}

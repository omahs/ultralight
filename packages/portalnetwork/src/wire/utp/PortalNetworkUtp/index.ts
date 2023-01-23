import { BitVectorType, toHexString } from '@chainsafe/ssz'
import { Debugger } from 'debug'
import {
  ConnectionState,
  Packet,
  PacketType,
  randUint16,
  UtpSocket,
  bitmap,
  SelectiveAckHeader,
  Bytes32TimeStamp,
} from '../index.js'
import { ProtocolId } from '../../../index.js'
import {
  HistoryNetworkContentKey,
  HistoryNetworkContentTypes,
} from '../../../subprotocols/history/index.js'
import { BasicUtp } from '../Protocol/BasicUtp.js'
import { ContentRequest } from './ContentRequest.js'
import { dropPrefixes, encodeWithVariantPrefix } from '../Utils/variantPrefix.js'
import ContentReader from '../Protocol/read/ContentReader.js'

type UtpSocketKey = string

export enum RequestCode {
  'FOUNDCONTENT_WRITE' = 0,
  'FINDCONTENT_READ' = 1,
  'OFFER_WRITE' = 2,
  'ACCEPT_READ' = 3,
}

export function createSocketKey(remoteAddr: string, sndId: number, rcvId: number) {
  return `${remoteAddr.slice(0, 5)}-${sndId}-${rcvId}`
}
export interface INewRequest {
  contentKeys: Uint8Array[]
  peerId: string
  connectionId: number
  requestCode: RequestCode
  contents?: Uint8Array[]
}
export class PortalNetworkUTP extends BasicUtp {
  openContentRequest: Map<UtpSocketKey, ContentRequest> // TODO enable other networks
  logger: Debugger
  working: boolean

  constructor(logger: Debugger) {
    super()
    this.logger = logger.extend(`uTP`)
    this.openContentRequest = new Map()
    this.working = false
  }

  closeRequest(packet: Buffer, peerId: string) {
    const requestKey = this.getRequestKeyFromPortalMessage(packet, peerId)
    const request = this.openContentRequest.get(requestKey)
    if (request) {
      this.sendResetPacket(request.socket)
      this.logger.extend('CLOSING')(`Closing uTP request with ${peerId} due to failed connection`)
      request.close()
      this.openContentRequest.delete(requestKey)
    }
  }

  getRequestKeyFromPortalMessage(packetBuffer: Buffer, peerId: string): string {
    const packet = Packet.bufferToPacket(packetBuffer)
    const connId = packet.header.connectionId
    const idA = connId + 1
    const idB = connId - 1
    const keyA = createSocketKey(peerId, connId, idA)
    const keyB = createSocketKey(peerId, idA, connId)
    const keyC = createSocketKey(peerId, idB, connId)
    const keyD = createSocketKey(peerId, connId, idB)
    for (const key of [keyA, keyB, keyC, keyD]) {
      if (this.openContentRequest.get(key) !== undefined) {
        return key
      }
    }
    throw new Error(
      `Cannot Find Open Request for socketKey ${keyA} or ${keyB} or ${keyC} or ${keyD}`
    )
  }

  createPortalNetworkUTPSocket(
    requestCode: RequestCode,
    peerId: string,
    sndId: number,
    rcvId: number,
    content?: Uint8Array
  ): UtpSocket {
    let socket: UtpSocket
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        socket = this.createNewSocket(
          peerId,
          sndId,
          rcvId,
          randUint16(),
          0,
          'write',
          this.logger,
          content
        )
        return socket
      case RequestCode.FINDCONTENT_READ:
        socket = this.createNewSocket(peerId, sndId, rcvId, 0, 1, 'read', this.logger)
        return socket
      case RequestCode.OFFER_WRITE:
        socket = this.createNewSocket(
          peerId,
          sndId,
          rcvId,
          1,
          randUint16(),
          'write',
          this.logger,
          content
        )
        return socket
      case RequestCode.ACCEPT_READ:
        socket = this.createNewSocket(peerId, sndId, rcvId, randUint16(), 0, 'read', this.logger)
        return socket
    }
  }

  async handleNewRequest(params: INewRequest): Promise<ContentRequest> {
    const { contentKeys, peerId, connectionId, requestCode } = params
    let contents = params.contents
    let sndId: number
    let rcvId: number
    let socket: UtpSocket
    let socketKey: string
    let newRequest: ContentRequest
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        sndId = connectionId
        rcvId = connectionId + 1
        socket = this.createPortalNetworkUTPSocket(requestCode, peerId, sndId, rcvId, contents![0])!
        socketKey = createSocketKey(peerId, sndId, rcvId)
        newRequest = new ContentRequest(
          ProtocolId.HistoryNetwork,
          requestCode,
          socket,
          socketKey,
          Uint8Array.from([]),
          contentKeys
        )

        this.openContentRequest.set(socketKey, newRequest)
        this.logger(`Opening request with key: ${socketKey}`)
        this.logger('Waiting for SYN Packet')
        await newRequest.init()
        break
      case RequestCode.FINDCONTENT_READ:
        sndId = connectionId + 1
        rcvId = connectionId
        socket = this.createPortalNetworkUTPSocket(requestCode, peerId, sndId, rcvId)!
        socketKey = createSocketKey(peerId, sndId, rcvId)
        newRequest = new ContentRequest(
          ProtocolId.HistoryNetwork,
          requestCode,
          socket,
          socketKey,
          Uint8Array.from([]),
          contentKeys
        )

        this.openContentRequest.set(socketKey, newRequest)
        this.logger(`Opening request with key: ${socketKey}`)
        await newRequest.init()
        break
      case RequestCode.OFFER_WRITE:
        this.logger(`Opening a uTP socket to send ${contents!.length} pieces of content`)

        sndId = connectionId + 1
        rcvId = connectionId
        socketKey = createSocketKey(peerId, sndId, rcvId)
        this.logger(
          `Encoding ${
            contents!.length
          } contents with VarInt prefix for stream as a single bytestring`
        )
        contents = [encodeWithVariantPrefix(contents!)]
        socket = this.createPortalNetworkUTPSocket(requestCode, peerId, sndId, rcvId, contents![0])!
        newRequest = new ContentRequest(
          ProtocolId.HistoryNetwork,
          requestCode,
          socket,
          socketKey,
          contents![0],
          contentKeys
        )

        this.openContentRequest.set(socketKey, newRequest)
        this.logger(`Opening request with key: ${socketKey}`)
        await newRequest.init()
        break
      default:
        //      case RequestCode.ACCEPT_READ:
        sndId = connectionId
        rcvId = connectionId + 1
        socketKey = createSocketKey(peerId, sndId, rcvId)

        this.logger(`Opening request with key: ${socketKey}`)
        socket = this.createPortalNetworkUTPSocket(requestCode, peerId, sndId, rcvId)!
        newRequest = new ContentRequest(
          ProtocolId.HistoryNetwork,
          requestCode,
          socket,
          socketKey,
          Uint8Array.from([]),
          contentKeys
        )
        this.openContentRequest.set(socketKey, newRequest)
        await newRequest.init()

        break
    }
    return newRequest
  }

  async handleUtpPacket(packetBuffer: Buffer, srcId: string): Promise<void> {
    const timeReceived = Bytes32TimeStamp()
    const requestKey = this.getRequestKeyFromPortalMessage(packetBuffer, srcId)
    const request = this.openContentRequest.get(requestKey)
    if (request) {
      clearTimeout(request.socket.timeoutCounter)
      const packet = Packet.bufferToPacket(packetBuffer)
      request.socket.updateDelay(timeReceived, packet.header.timestampMicroseconds)

      switch (packet.header.pType) {
        case PacketType.ST_SYN:
          request.socket.logger(`Received ST_SYN   sndId: ${packet.header.connectionId}`)
          requestKey && (await this._handleSynPacket(request, packet))
          break
        case PacketType.ST_DATA:
          request.socket.logger(`Received ST_DATA  seqNr: ${packet.header.seqNr}`)
          requestKey && (await this._handleDataPacket(request, packet))
          break
        case PacketType.ST_STATE:
          request.socket.logger(`Received ST_STATE ackNr: ${packet.header.ackNr}`)
          if (packet.header.extension === 1) {
            await this._handleSelectiveAckPacket(request, packet)
          } else {
            await this._handleStatePacket(request, packet)
          }
          break
        case PacketType.ST_RESET:
          request.socket.logger(`Received ST_RESET`)
          break
        case PacketType.ST_FIN:
          request.socket.logger(`Received ST_FIN   seqNr: ${packet.header.seqNr}`)
          requestKey && (await this._handleFinPacket(request, packet))
          break
        default:
          throw new Error(`Unknown Packet Type ${packet.header.pType}`)
      }
    }
  }

  async send(peerId: string, msg: Buffer, protocolId: ProtocolId) {
    this.emit('Send', peerId, msg, protocolId, true)
  }

  async _handleSynPacket(request: ContentRequest, packet: Packet): Promise<void | ContentReader> {
    const requestCode = request.requestCode
    let writer

    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        this.logger(`SYN received to initiate stream for FINDCONTENT request`)
        request.socket.ackNr = packet.header.seqNr
        request.socket.seqNr = packet.header.seqNr
        await this.sendSynAckPacket(request.socket)
        writer = await this.createNewWriter(request.socket, request.socket.seqNr)
        request.socket.writer = writer
        request.socket.writer?.start()
        break
      case RequestCode.ACCEPT_READ:
        this.logger('SYN received to initiate stream for OFFER/ACCEPT request')
        request.socket.ackNr = packet.header.seqNr
        request.socket.reader = await this.createNewReader(request.socket, 2)
        await this.sendSynAckPacket(request.socket)
        return request.socket.reader
      default:
        throw new Error('I send SYNs, I do not handle them.')
    }
  }
  async _handleStatePacket(request: ContentRequest, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    const sentTime = request.socket.outBuffer.get(packet.header.ackNr)
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        if (packet.header.ackNr > request.socket.writer!.startingSeqNr) {
          request.socket.ackNrs = Object.keys(request.socket.writer!.dataChunks)
            .filter((n) => parseInt(n) <= packet.header.ackNr)
            .map((n) => parseInt(n))
        }
        if (request.socket.type === 'write' && sentTime != undefined) {
          const rtt = packet.header.timestampMicroseconds - sentTime
          request.socket.updateRTT(rtt)
          request.socket.outBuffer.delete(packet.header.ackNr)
        }
        await this.handleStatePacket(request.socket, packet)

        break
      case RequestCode.FINDCONTENT_READ:
        if (packet.header.ackNr === 0) {
          this.logger(`SYN-ACK received for FINDCONTENT request  Waiting for DATA.`)
          const startingSeqNr = request.socket.seqNr + 1
          request.socket.ackNr = packet.header.seqNr
          const reader = await this.createNewReader(request.socket, startingSeqNr)
          request.socket.reader = reader
        } else {
          throw new Error('READ socket should not get acks')
        }
        break
      case RequestCode.OFFER_WRITE:
        if (request.socket.seqNr === 1) {
          request.socket.state = ConnectionState.Connected
          request.socket.ackNr = packet.header.seqNr - 1
          request.socket.seqNr = 2
          request.socket.logger(
            `SYN-ACK received for OFFERACCEPT request with connectionId: ${packet.header.connectionId}.  Beginning DATA stream.`
          )
          request.socket.writer?.start()
        } else if (packet.header.ackNr === request.socket.finNr) {
          request.socket.logger(`FIN Packet ACK received.  Closing Socket.`)
          clearTimeout(request.socket.timeoutCounter)
        } else {
          request.socket.ackNrs = Object.keys(request.socket.writer!.dataChunks)
            .filter((n) => parseInt(n) <= packet.header.ackNr)
            .map((n) => parseInt(n))
          request.socket.logger(
            `ST_STATE (Ack) Packet Received.  SeqNr: ${packet.header.seqNr}, AckNr: ${packet.header.ackNr}`
          )
          if (sentTime != undefined) {
            const rtt = packet.header.timestampMicroseconds - sentTime
            request.socket.updateRTT(rtt)
            request.socket.outBuffer.delete(packet.header.ackNr)
          }
          await this.handleStatePacket(request.socket, packet)
        }
        break
      case RequestCode.ACCEPT_READ:
        throw new Error('Why did I get a STATE packet?')
    }
  }
  public static bitmaskToAckNrs(bitmask: Uint8Array, ackNr: number): number[] {
    const bitArray = new BitVectorType(32).deserialize(bitmask)
    const ackNrs = bitArray.getTrueBitIndexes().map((index) => {
      return bitmap[index] + ackNr
    })
    return ackNrs
  }
  async _handleSelectiveAckPacket(request: ContentRequest, packet: Packet): Promise<void> {
    const ackNrs = PortalNetworkUTP.bitmaskToAckNrs(
      (packet.header as SelectiveAckHeader).selectiveAckExtension.bitmask,
      request.socket.ackNr
    )
    const acked = ackNrs.find((a) => !request.socket.ackNrs.includes(a))
    request.socket.logger(
      `ST_STATE (SELECTIVE_ACK) received with ackNr: ${
        packet.header.ackNr
      }, and a bitmask referencing ackNrs: ${ackNrs}.  Packet acks DATA packet seqNr: ${acked}.  Receive socket still waits for seqNr: ${
        packet.header.ackNr + 1
      }`
    )
    if (acked) {
      request.socket.rtt = request.socket.reply_micro - request.socket.outBuffer.get(acked)!
      request.socket.outBuffer.delete(acked)
      request.socket.ackNrs.push(acked)
    }
    const requestCode = request.requestCode
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
      case RequestCode.OFFER_WRITE:
        if (ackNrs.length >= 3) {
          // If packet is more than 3 behind, assume it to be lost and resend.
          request.socket.writer!.seqNr = packet.header.ackNr + 1
        }
        await this.handleStatePacket(request.socket, packet)
        return
      case RequestCode.FINDCONTENT_READ:
      case RequestCode.ACCEPT_READ:
        throw new Error('Why did I get a SELECTIVE ACK packet?')
    }
  }
  async _handleDataPacket(request: ContentRequest, packet: Packet) {
    const requestCode = request.requestCode
    switch (requestCode) {
      case RequestCode.FINDCONTENT_READ:
      case RequestCode.ACCEPT_READ:
        return await this.handleDataPacket(request.socket, packet)

      default:
        throw new Error('Why did I get a DATA packet?')
    }
  }
  async _handleResetPacket(request: ContentRequest) {
    request.socket.close()
  }
  async _handleFinPacket(request: ContentRequest, packet: Packet) {
    const requestCode = request.requestCode
    const keys = request.contentKeys
    const streamer = async (content: Uint8Array) => {
      this.logger(`Decompressing stream into ${keys.length} pieces of content`)
      let contents = [content]
      if (requestCode === RequestCode.ACCEPT_READ) {
        contents = dropPrefixes(content)
      }
      if (keys.length < 1) {
        throw new Error('Missing content keys')
      }
      for (const [idx, k] of keys.entries()) {
        const decodedContentKey = {
          selector: k[0],
          blockHash: k.subarray(1),
        } as HistoryNetworkContentKey
        const _content = contents[idx]
        this.logger.extend(`FINISHED`)(
          `${idx + 1}/${keys.length} -- sending ${HistoryNetworkContentTypes[k[0]]} to database`
        )
        this.emit('Stream', k[0], toHexString(decodedContentKey.blockHash), _content)
      }
    }

    let content
    switch (requestCode) {
      case RequestCode.FINDCONTENT_READ:
      case RequestCode.ACCEPT_READ:
        content = await request.socket.handleFinPacket(packet)
        content && streamer(content)
        request.socket.logger(`Closing uTP Socket`)
        clearTimeout(request.socket.timeoutCounter)

        break
      case RequestCode.FOUNDCONTENT_WRITE:
      case RequestCode.OFFER_WRITE:
      default:
        this.logger('I send FIN not handle FIN')
        return false
    }
    return true
  }
}

export * from './ContentRequest.js'
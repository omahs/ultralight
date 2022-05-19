import { NodeId } from '@chainsafe/discv5'
import { toHexString } from '@chainsafe/ssz'
import { SubprotocolIds } from '../../../subprotocols'
import { Packet } from '../Packets'
import { sendAckPacket, sendFinPacket, sendSynAckPacket } from '../Packets/PacketSenders'
import { ConnectionState } from '../Socket'
import { randUint16 } from '../Utils'
import { ContentRequest } from './ContentRequest'
import { RequestCode } from './PortalNetworkUTP'

export default class PacketHandlers {
  log: (message: string) => void
  send: (dstId: NodeId, payload: Buffer, protocolId: SubprotocolIds, utpMessage?: boolean) => void
  stream: (chainId: number, blockHash: string, content: Uint8Array) => void
  constructor(
    log: (message: string, extension?: string) => void,
    send: (
      dstId: NodeId,
      payload: Buffer,
      protocolId: SubprotocolIds,
      utpMessage?: boolean
    ) => void,
    stream: (chainId: number, blockHash: string, content: Uint8Array) => void
  ) {
    this.log = log
    this.send = send
    this.stream = stream
  }

  async handleSynPacket(request: ContentRequest, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    let writer
    let reader
    try {
      switch (requestCode) {
        case RequestCode.FOUNDCONTENT_WRITE:
          this.log(`SYN received to initiate stream for FINDCONTENT request`)
          this.log(`Expected: 1-RANDOM`)
          this.log(`Received: ${packet.header.seqNr} - ${packet.header.ackNr}`)
          request.socket.ackNr = packet.header.seqNr
          request.socket.seqNr = randUint16()
          writer = await request.socket.createNewWriter(request.socket, request.socket.seqNr)
          request.writer = writer
          await sendSynAckPacket(request.socket)
          request.socket.nextSeq = request.socket.seqNr + 1
          request.socket.nextAck = packet.header.ackNr + 1
          await request.writer?.start()
          break
        case RequestCode.FINDCONTENT_READ:
          this.log(`Why did I get a SYN?`)
          break
        case RequestCode.OFFER_WRITE:
          this.log(`Why did I get a SYN?`)
          break
        case RequestCode.ACCEPT_READ:
          this.log('SYN received to initiate stream for OFFER/ACCEPT request')
          request.socket.ackNr = packet.header.seqNr
          request.socket.nextSeq = 2
          request.socket.nextAck = packet.header.ackNr
          reader = await request.socket.createNewReader(request.socket, 2)
          request.socket.reader = reader
          await request.socket.handleSynPacket()
          break
      }
    } catch {
      this.log('Request Type Not Implemented')
    }
  }
  async handleStatePacket(request: ContentRequest, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        break
      case RequestCode.FINDCONTENT_READ:
        if (packet.header.ackNr === 1) {
          this.log(
            `SYN-ACK received for FINDCONTENT request.  Sending SYN-ACK-ACK.  Waiting for DATA.`
          )
          this.log(`Expecting: RANDOM-1`)
          this.log(`Received: ${packet.header.seqNr} - ${packet.header.ackNr}`)
          const startingSeqNr = request.socket.seqNr + 1
          request.socket.ackNr = packet.header.seqNr
          request.socket.seqNr = 2
          request.socket.nextSeq = packet.header.seqNr + 1
          request.socket.nextAck = packet.header.ackNr + 1
          const reader = await request.socket.createNewReader(request.socket, startingSeqNr)
          request.reader = reader
          await sendAckPacket(request.socket)
        } else {
          this.log(`Expecting: ${request.socket.nextSeq} - ${request.socket.nextAck}`)
          this.log(`Received: ${packet.header.seqNr} - ${packet.header.ackNr}`)
          await request.socket.handleStatePacket(packet)
        }
        break
      case RequestCode.OFFER_WRITE:
        if (request.socket.seqNr === 1) {
          request.socket.state = ConnectionState.Connected
          request.socket.ackNr = packet.header.seqNr - 1
          request.socket.seqNr = 2
          request.socket.nextSeq = packet.header.seqNr + 1
          request.socket.nextAck = 2
          request.socket.logger(`SYN-ACK received for OFFERACCEPT request.  Beginning DATA stream.`)
          await request.writer?.start()
          await sendFinPacket(request.socket)
        } else if (packet.header.ackNr === request.socket.finNr) {
          request.socket.logger(
            `FIN Packet ACK received.  Closing Socket.  There are ${request.sockets.length} more pieces of content to send.`
          )
          if (request.sockets.length > 0) {
            this.log(`Starting next Stream`)
            await request.init()
          }
        } else {
          request.socket.logger('Ack Packet Received.')
          request.socket.logger(`Expected... ${request.socket.nextSeq} - ${request.socket.nextAck}`)
          request.socket.logger(`Got........ ${packet.header.seqNr} - ${packet.header.ackNr}`)
          //  request.socket.seqNr = request.socket.seqNr + 1
          request.socket.nextSeq = packet.header.seqNr + 1
          request.socket.nextAck = packet.header.ackNr + 1
          await request.socket.handleStatePacket(packet)
        }
        break
      case RequestCode.ACCEPT_READ:
        this.log('Why did I get a STATE packet?')
        break
    }
  }

  async handleDataPacket(request: ContentRequest, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    try {
      switch (requestCode) {
        case RequestCode.FOUNDCONTENT_WRITE:
          throw new Error('Why did I get a DATA packet?')
        case RequestCode.FINDCONTENT_READ:
          await request.socket.handleDataPacket(packet)
          break
        case RequestCode.OFFER_WRITE:
          throw new Error('Why did I get a DATA packet?')
        case RequestCode.ACCEPT_READ:
          await request.socket.handleDataPacket(packet)
          break
      }
    } catch {
      throw new Error('Request Type not implemented')
    }
  }

  async handleFinPacket(request: ContentRequest, packet: Packet): Promise<void> {
    const contentKey = request.contentKey as {
      chainId: number
      blockHash: Uint8Array
    }
    const requestCode = request.requestCode
    const streamer = async (content: Uint8Array) => {
      this.stream(contentKey.chainId, toHexString(contentKey.blockHash), content)
    }
    let content
    try {
      switch (requestCode) {
        case RequestCode.FOUNDCONTENT_WRITE:
          throw new Error('Why did I get a FIN packet?')
        case RequestCode.FINDCONTENT_READ:
          content = await request.socket.handleFinPacket(packet)
          streamer(content!)
          request.socket.logger(`Closing uTP Socket`)
          break
        case RequestCode.OFFER_WRITE:
          throw new Error('Why did I get a FIN packet?')
        case RequestCode.ACCEPT_READ:
          content = await request.socket.handleFinPacket(packet)
          streamer(content!)
          request.socket.logger(`Closing uTP Socket`)
          if (request.sockets.length > 0) {
            request.socket = request.sockets.pop()!
            request.contentKey = request.contentKeys.pop()!
            await request.init()
          }
          break
      }
    } catch (err) {
      this.log('Error processing FIN packet')
      this.log((err as any).message)
    }
  }
}

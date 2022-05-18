import { toHexString } from '@chainsafe/ssz'
import { Debugger } from 'debug'
import { Packet } from '../Packets'
import { BasicUtp } from '../Protocol'
import { ConnectionState } from '../Socket'
import { randUint16 } from '../Utils'
import { ContentRequest } from './ContentRequest'
import { PortalNetworkUTP, RequestCode } from './PortalNetworkUTP'

export default class PacketHandlers {
  protocol: PortalNetworkUTP
  utp: BasicUtp
  logger: Debugger
  constructor(protocol: PortalNetworkUTP) {
    this.protocol = protocol
    this.logger = protocol.logger
    this.utp = this.protocol.protocol
  }

  async handleSynPacket(request: ContentRequest<any>, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    let writer
    let reader
    try {
      switch (requestCode) {
        case RequestCode.FOUNDCONTENT_WRITE:
          this.logger(`SYN received to initiate stream for FINDCONTENT request`)
          this.logger(`Expected: 1-RANDOM`)
          this.logger(`Received: ${packet.header.seqNr} - ${packet.header.ackNr}`)
          request.socket.ackNr = packet.header.seqNr
          request.socket.seqNr = randUint16()
          writer = await this.utp.createNewWriter(request.socket, request.socket.seqNr)
          request.writer = writer
          await this.utp.sendSynAckPacket(request.socket)
          request.socket.nextSeq = request.socket.seqNr + 1
          request.socket.nextAck = packet.header.ackNr + 1
          await request.writer?.start()
          break
        case RequestCode.FINDCONTENT_READ:
          this.logger(`Why did I get a SYN?`)
          break
        case RequestCode.OFFER_WRITE:
          this.logger(`Why did I get a SYN?`)
          break
        case RequestCode.ACCEPT_READ:
          this.logger('SYN received to initiate stream for OFFER/ACCEPT request')
          request.socket.ackNr = packet.header.seqNr
          request.socket.nextSeq = 2
          request.socket.nextAck = packet.header.ackNr
          reader = await this.utp.createNewReader(request.socket, 2)
          request.socket.reader = reader
          await this.utp.handleSynPacket(request.socket, packet)
          break
      }
    } catch {
      this.logger('Request Type Not Implemented')
    }
  }
  async handleStatePacket(request: ContentRequest<any>, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    switch (requestCode) {
      case RequestCode.FOUNDCONTENT_WRITE:
        break
      case RequestCode.FINDCONTENT_READ:
        if (packet.header.ackNr === 1) {
          this.logger(
            `SYN-ACK received for FINDCONTENT request.  Sending SYN-ACK-ACK.  Waiting for DATA.`
          )
          this.logger(`Expecting: RANDOM-1`)
          this.logger(`Received: ${packet.header.seqNr} - ${packet.header.ackNr}`)
          const startingSeqNr = request.socket.seqNr + 1
          request.socket.ackNr = packet.header.seqNr
          request.socket.seqNr = 2
          request.socket.nextSeq = packet.header.seqNr + 1
          request.socket.nextAck = packet.header.ackNr + 1
          const reader = await this.utp.createNewReader(request.socket, startingSeqNr)
          request.reader = reader
          await this.utp.sendStatePacket(request.socket)
        } else {
          this.logger(`Expecting: ${request.socket.nextSeq} - ${request.socket.nextAck}`)
          this.logger(`Received: ${packet.header.seqNr} - ${packet.header.ackNr}`)
          this.utp.handleStatePacket(request.socket, packet)
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
          await this.utp.sendFinPacket(request.socket)
        } else if (packet.header.ackNr === request.socket.finNr) {
          request.socket.logger(
            `FIN Packet ACK received.  Closing Socket.  There are ${request.sockets.length} more pieces of content to send.`
          )
          if (request.sockets.length > 0) {
            this.logger(`Starting next Stream`)
            await request.init()
          }
        } else {
          request.socket.logger('Ack Packet Received.')
          request.socket.logger(`Expected... ${request.socket.nextSeq} - ${request.socket.nextAck}`)
          request.socket.logger(`Got........ ${packet.header.seqNr} - ${packet.header.ackNr}`)
          //  request.socket.seqNr = request.socket.seqNr + 1
          request.socket.nextSeq = packet.header.seqNr + 1
          request.socket.nextAck = packet.header.ackNr + 1
          await this.utp.handleStatePacket(request.socket, packet)
        }
        break
      case RequestCode.ACCEPT_READ:
        this.logger('Why did I get a STATE packet?')
        break
    }
  }

  async handleDataPacket(request: ContentRequest<any>, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    try {
      switch (requestCode) {
        case RequestCode.FOUNDCONTENT_WRITE:
          throw new Error('Why did I get a DATA packet?')
        case RequestCode.FINDCONTENT_READ:
          await this.utp.handleDataPacket(request.socket, packet)
          break
        case RequestCode.OFFER_WRITE:
          throw new Error('Why did I get a DATA packet?')
        case RequestCode.ACCEPT_READ:
          await this.utp.handleDataPacket(request.socket, packet)
          break
      }
    } catch {
      this.logger('Request Type Not Implemented')
    }
  }
  async handleResetPacket(request: ContentRequest<any>): Promise<void> {
    const requestCode = request.requestCode
    delete this.protocol.openContentRequests[requestCode]
  }
  async handleFinPacket(request: ContentRequest<any>, packet: Packet): Promise<void> {
    const requestCode = request.requestCode
    const streamer = async (content: Uint8Array) => {
      this.protocol.emit('contentReady', [
        request.contentKey.chainId,
        toHexString(request.contentKey.blockHash),
        content,
      ])
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
      this.logger('Error processing FIN packet')
      this.logger(err)
    }
  }
}

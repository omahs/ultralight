import { ENR } from '@chainsafe/discv5'
import { toHexString } from '@chainsafe/ssz'
import { Multiaddr } from 'multiaddr'
import PeerId from 'peer-id'
import tape from 'tape'
import { PortalNetwork, SubNetworkIds } from '../../src'
import {
  Packet,
  PacketHeader,
  PacketType,
  SelectiveAckHeader,
  bufferToPacket,
} from '../../src/wire/utp'

tape('uTP encoding tests', (t) => {
  t.test('SYN packet encoding test', (st) => {
    const synPacketHeader = new PacketHeader({
      pType: PacketType.ST_SYN,
      version: 1,
      extension: 0,
      connectionId: 10049,
      timestamp: 3384187322,
      timestampDiff: 0,
      wndSize: 1048576,
      seqNr: 11884,
      ackNr: 0,
    })
    const synPacket = new Packet({ header: synPacketHeader, payload: Uint8Array.from([]) })
    const encodedPacket = synPacket.encodePacket()
    const decodedPacket = bufferToPacket(encodedPacket)
    st.equal(
      Object.entries(synPacketHeader).toString(),
      Object.entries(decodedPacket.header).toString(),
      'sucessfully decoded SYN packet header'
    )
    st.strictEquals(
      toHexString(encodedPacket),
      '0x41002741c9b699ba00000000001000002e6c0000',
      'successfully encoded SYN packet'
    )
    st.end()
  })
  t.test('ACK packet encoding test', (st) => {
    const ackPacketHeader = new PacketHeader({
      pType: PacketType.ST_STATE,
      version: 1,
      extension: 0,
      connectionId: 10049,
      timestamp: 6195294,
      timestampDiff: 916973699,
      wndSize: 1048576,
      seqNr: 16807,
      ackNr: 11885,
    })
    const ackPacket = new Packet({ header: ackPacketHeader, payload: Uint8Array.from([]) })
    const encodedPacket = ackPacket.encodePacket()
    const decodedPacket = bufferToPacket(encodedPacket)
    st.equal(
      Object.entries(ackPacketHeader).toString(),
      Object.entries(decodedPacket.header).toString(),
      'sucessfully decoded SYN packet header'
    )
    st.strictEquals(
      toHexString(encodedPacket),
      '0x21002741005e885e36a7e8830010000041a72e6d',
      'successfully encoded ACK packet'
    )
    st.end()
  })
  t.test('ACK packet with selective ACK encoding test', (st) => {
    const selectiveAckPacketHeader = new SelectiveAckHeader(
      {
        pType: PacketType.ST_STATE,
        version: 1,
        extension: 1,
        connectionId: 10049,
        timestamp: 6195294,
        timestampDiff: 916973699,
        wndSize: 1048576,
        seqNr: 16807,
        ackNr: 11885,
      },
      Uint8Array.from([1, 0, 0, 128])
    )
    const selectiveAckPacket = new Packet({
      header: selectiveAckPacketHeader,
      payload: Uint8Array.from([]),
    })
    const encodedPacket = selectiveAckPacket.encodePacket()
    const decodedPacket = bufferToPacket(encodedPacket)
    const decodedPacketHeader = decodedPacket.header as SelectiveAckHeader
    st.equal(
      Object.entries(selectiveAckPacket.header).toString(),
      Object.entries(decodedPacket.header).toString(),
      'sucessfully decoded Selective-ACK packet header'
    )
    st.equal(
      Uint8Array.from(decodedPacketHeader.selectiveAckExtension.bitmask).toString(),
      Uint8Array.from([1, 0, 0, 128]).toString(),
      `sucessfully decoded Selecive Ack Bitmask ${Uint8Array.from([1, 0, 0, 128])}`
    )
    st.strictEquals(
      toHexString(encodedPacket),
      '0x21012741005e885e36a7e8830010000041a72e6d000401000080',
      'successfully encoded selective ACK packet'
    )
    st.end()
  })

  t.test('DATA packet encoding test', (st) => {
    const dataPacketHeader = new PacketHeader({
      pType: PacketType.ST_DATA,
      version: 1,
      extension: 0,
      connectionId: 26237,
      timestamp: 252492495,
      timestampDiff: 242289855,
      wndSize: 1048576,
      seqNr: 8334,
      ackNr: 16806,
    })
    const dataPacket = new Packet({
      header: dataPacketHeader,
      payload: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    })
    const encodedPacket = dataPacket.encodePacket()
    const decodedPacket = bufferToPacket(encodedPacket)
    st.equal(
      Object.entries(dataPacket.header).toString(),
      Object.entries(decodedPacket.header).toString(),
      'sucessfully decoded DATA packet header'
    )
    st.equal(
      Uint8Array.from(decodedPacket.payload).toString(),
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).toString(),
      `successfully decoded DATA packet payload`
    )
    st.strictEquals(
      toHexString(encodedPacket),
      '0x0100667d0f0cbacf0e710cbf00100000208e41a600010203040506070809',
      'successfully encoded DATA packet'
    )
    st.end()
  })
  t.test('FIN packet encoding test', (st) => {
    const finPacketHeader = new PacketHeader({
      pType: PacketType.ST_FIN,
      version: 1,
      extension: 0,
      connectionId: 19003,
      timestamp: 515227279,
      timestampDiff: 511481041,
      wndSize: 1048576,
      seqNr: 41050,
      ackNr: 16806,
    })
    const finPacket = new Packet({ header: finPacketHeader, payload: Uint8Array.from([]) })
    const encodedPacket = finPacket.encodePacket()
    const decodedPacket = bufferToPacket(encodedPacket)
    st.equal(
      Object.entries(finPacketHeader).toString(),
      Object.entries(decodedPacket.header).toString(),
      'sucessfully decoded FIN packet header'
    )
    st.strictEquals(
      toHexString(encodedPacket),
      '0x11004a3b1eb5be8f1e7c94d100100000a05a41a6',
      'successfully encoded FIN packet'
    )
    st.end()
  })
  t.test('RESET packet encoding test', (st) => {
    const resetPacketHeader = new PacketHeader({
      pType: PacketType.ST_RESET,
      version: 1,
      extension: 0,
      connectionId: 62285,
      timestamp: 751226811,
      timestampDiff: 0,
      wndSize: 0,
      seqNr: 55413,
      ackNr: 16807,
    })
    const resetPacket = new Packet({ header: resetPacketHeader, payload: Uint8Array.from([]) })
    const encodedPacket = resetPacket.encodePacket()
    const decodedPacket = bufferToPacket(encodedPacket)
    st.equal(
      Object.entries(resetPacketHeader).toString(),
      Object.entries(decodedPacket.header).toString(),
      'sucessfully decoded RESET packet header'
    )
    st.strictEquals(
      toHexString(encodedPacket),
      '0x3100f34d2cc6cfbb0000000000000000d87541a7',
      'successfully encoded RESET packet'
    )
    st.end()
  })
})

// Start the proxy and a CLI node.  Copy ENR and NodeId from CLI node and paste in here.  Then run test.

tape('uTP packet handling', async (t) => {
  const id = await PeerId.create({ keyType: 'secp256k1' })
  const enr = ENR.createFromPeerId(id)
  enr.setLocationMultiaddr(new Multiaddr('/ip4/127.0.0.1/udp/0'))
  const portal = new PortalNetwork(
    {
      enr: enr,
      peerId: id,
      multiaddr: new Multiaddr('/ip4/127.0.0.1/udp/0'),
      transport: 'wss',
      proxyAddress: `ws://127.0.0.1:5050`,
    },
    1
  )
  await portal.start()
  portal.client.addEnr(
    'enr:-IS4QJjMgpYDTSWA4W4g4pawY2xW_oHC-xQTF0NpDTgB1YzsJY_LtF0imQ7S0VI2rqMhQOcMhgewhzlu6HqFS53JNwMFgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQLA9-i3dQyeTQ0Y8HAO64Zr0iqEYh2VROv2yRLxxINnTIN1ZHCC6rI'
  )

  t.test('Portal Client Test', (st) => {
    st.ok(portal.client.isStarted(), 'Portal Client Started')
    st.ok(portal.sendPing('711005b49b508445c0eb0bbdfc7052b50edd7754f88a1a22650966f2727d751a', SubNetworkIds.HistoryNetwork).then(() => {return true}).catch(() => {return false})
    , "Ping-Pong successful")  
  })
})

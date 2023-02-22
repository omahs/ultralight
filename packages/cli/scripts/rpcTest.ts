import jayson from 'jayson/promise/index.js'
import { fromHexString, getContentId, ProtocolId } from 'portalnetwork'

const testBlocks = [
  {
    hash: '0x8faf8b77fedb23eb4d591433ac3643be1764209efa52ac6386e10d1a127e4220',
    rlp: '0xf9028df90217a013ced9eaa49a522d4e7dcf80a739a57dbf08f4ce5efc4edbac86a66d8010f693a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d493479452bc44d5378309ee2abf1539bf71de1b7d7be3b5a0ac4ba3fe45d38b28e2af093024e112851a0f3c72bf1d02b306506e93cd39e26da068d722d467154a4570a7d759cd6b08792c4a1cb994261196b99735222b513bd9a00db8f50b32f1ec33d2546b4aa485defeae3a4e88d5f90fdcccadd6dff516e4b9b90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008605af25e8b8e583030d41832fefd88252088455ee029798d783010102844765746887676f312e342e32856c696e7578a0ee8523229bf562950f30ad5a85be3fabc3f19926ee479826d54d4f5f2728c245880a0fb916fd59aad0f870f86e822d85850ba43b740083015f90947c5080988c6d91d090c23d54740f856c69450b29874b04c0f2616400801ba09aaf0e60d53dfb7c34ed51991bd350b8e021185ccc070b4264e209d16df5dc08a03565399bd97800b6d0e9959cd0920702039642b85b37a799391181e0610d6ba9c0',
    number: 200001,
  },
  {
    hash: '0x0c1cf9b3d4aa3e20e12b355416a4e3202da53f54eaaafc882a7644e3e68127ec',
    rlp: '0xf9028ef90217a08faf8b77fedb23eb4d591433ac3643be1764209efa52ac6386e10d1a127e4220a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d493479452bc44d5378309ee2abf1539bf71de1b7d7be3b5a0bd0eaff61d52c20e085cb7a7c60b312c792e0b141c5a00e50fd42f8ae1cfe51da09b763cefd23adf252ba87898f7cb8ccc06a4ebddc6be9032648fd55789d4c0b8a0cbb141d48d01bbbf96fb19adff38fb2a6c5e3de40843472a91067ef4f9eac09fb90100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008605afdbcd75fd83030d42832fefd88252088455ee029f98d783010102844765746887676f312e342e32856c696e7578a04ddfa646f9a9ec8507af565631322186e2e06347586c9f137383d745ee8bf5958885808f6bbbb2a835f871f86f822d86850ba43b740083015f9094c197252baf4a4d2974eab91039594f789a8c207c88017a798d89731c00801ca0825c34f6ddfad0c9fe0e2aa75a3bff9bccc21e81a782fb2a454afb4ad4abac70a0106d3942a42839f74bbbf71b6ff8c5b11082af8b0ff2799cb9b8d14b7fcc9e11c0',
    number: 200002,
  },
]
const { Client } = jayson

const main = async () => {
  const ultralight = Client.http({ host: '127.0.0.1', port: 8545 })
  const peer0 = Client.http({ host: '127.0.0.1', port: 8546 })
  const ultralightENR = await ultralight.request('portal_nodeEnr', [])
  const peer0ENR = await peer0.request('portal_nodeEnr', [])
  console.log(ultralightENR.result.startsWith('enr:'))
  console.log(peer0ENR.result.startsWith('enr:'))

  const addBlock = await ultralight.request('portal_addBlockToHistory', [
    testBlocks[0].hash,
    testBlocks[0].rlp,
  ])
  console.log(addBlock.result === `blockheader for ${testBlocks[0].hash} added to content DB`)
  const addBlock2 = await peer0.request('portal_addBlockToHistory', [
    testBlocks[1].hash,
    testBlocks[1].rlp,
  ])
  console.log(addBlock2.result === `blockheader for ${testBlocks[1].hash} added to content DB`)

  const ping1 = await peer0.request('portal_ping', [
    ultralightENR.result,
    ProtocolId.HistoryNetwork,
  ])
  console.log(ping1.result.startsWith('PING'))
  const ping2 = await ultralight.request('portal_ping', [
    peer0ENR.result,
    ProtocolId.HistoryNetwork,
  ])
  console.log(ping2.result.startsWith('PING'))

  const findCon = await peer0.request('eth_getBlockByHash', [testBlocks[0].hash, true, ProtocolId.HistoryNetwork])
  console.log(findCon.result.header.number.slice(2) === (testBlocks[0].number.toString(16)))
  const findCon2 = await ultralight.request('eth_getBlockByHash', [testBlocks[1].hash, true, ProtocolId.HistoryNetwork])
  console.log(findCon2.result.header.number.slice(2) === (testBlocks[1].number.toString(16)))


}

main()

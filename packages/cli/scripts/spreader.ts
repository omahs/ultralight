import { Client } from 'jayson/promise'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import fs from 'fs'
import blockData from './blocks200000-210000.json'
import { BlockOptions } from '@ethereumjs/block'

const args: any = yargs(hideBin(process.argv)).option('numNodes', {
  describe: 'number of nodes in devnet',
  number: true,
  demandOption: true,
}).argv

const main = async () => {
  const targets = [`localhost:9090`]
  for (let x = 0; x < args.numNodes; x++) {
    targets.push(`localhost:1${8546 + x}`)
  }
  let targetBlob = [
    Object.assign({
      targets: targets,
      labels: { env: 'devnet' },
    }),
  ]
  fs.writeFileSync('./targets.json', JSON.stringify(targetBlob, null, 2))

  const blocks = Object.entries(blockData)
  const bootnodes = []
  for (let i = 0; i < args.numNodes; i++) {
    bootnodes.push(Client.http({ port: 8546 + i }))
  }
  bootnodes.forEach(async (bootnode) => {
    const node = await bootnode.request('portal_nodeEnr', [])
    // console.log(node.result)
  })
  for (let i = 1; i < bootnodes.length; i++) {
    const bootnode = bootnodes[i]
    const enr = await bootnodes[i - 1].request('portal_nodeEnr', [])
    const ping = await bootnode.request('portal_addBootNode', [enr.result])
    console.log(ping)
  }
  for (let i = 0; i < blocks.length; i++) {
    const index = i % 10
    const bootnode = bootnodes[index]
    await bootnode.request('portal_addBlockToHistory', [blocks[i][0], (blocks[i][1] as any).rlp])
    index === 0 && console.log(i)
  }
  for (let i = 0; i < 50; i ++) {
    const index = i % 10
    const b = Math.floor(Math.random() * 10000)
    const bootnode = bootnodes[index]
    const block = await bootnode.request('eth_getBlockByHash', [
      blocks[b][0],
      (blocks[b][1] as any).rlp,
    ])
    console.log(block)
  }

//   const block = await bootnodes[0].request('eth_getBlockByHash', [blocks[1][0], true])
//   console.log(block)
}

main()

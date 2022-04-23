import * as ssz from '@chainsafe/ssz'

const Uint256 = new ssz.NumberUintType({ byteLength: 32 })
const exampleType = new ssz.VectorType({ elementType: Uint256, length: 8 })

const n1 = 1111
const n2 = 2222
const n3 = 3333
const n4 = 4444
const n5 = 5555
const n6 = 6666
const n7 = 7777
const n8 = 8888

const vector = [n1, n2, n3, n4, n5, n6, n7, n8]
const serializedValues = vector.map((n, idx) => {
  return Uint256.serialize(n)
})
const serializedVector = exampleType.serialize(vector)
const deserializedVector = exampleType.deserialize(serializedVector)

const tree = exampleType.struct_convertToTree(serializedVector)
const leaves = exampleType.tree_getLeafGindices(tree)

const proofs = leaves.map((leaf) => {
  return tree.getSingleProof(leaf)
})

const map = vector.map((v, idx) => {
  return {
    value: v,
    idx: idx,
    serialized: serializedValues[idx],
    deserialized: deserializedVector[idx],
    gIndex: leaves[idx],
    proof: proofs[idx].map((p) => {
      return ssz.toHexString(p)
    }),
  }
})

const getProof = (value: number) => {
  const idx = vector.indexOf(value)
  const gIndex = exampleType.getGindexAtChunkIndex(idx)
  return (tree.getSingleProof(gIndex).map((p) => {
      return ssz.toHexString(p)
  }))
}

const proof1 = getProof(deserializedVector[1])
const proof2 = getProof(vector[1])

const run = () => {
  console.log(map)
  console.log(`Looking up proof for ${deserializedVector[1]}`)
  console.log(proof1)
  console.log(proof2)
  console.log(proof1.every((val, index) => val === proof2[index]))
  
}
run()

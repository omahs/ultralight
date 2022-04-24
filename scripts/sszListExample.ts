import * as ssz from '@chainsafe/ssz'

const valueType = new ssz.Number64UintType()
const exampleType = new ssz.ListType({ elementType: valueType, limit: 250 })

const length = Math.random() * 225 + 25
const list = []
for (let i = 0; i < length; i++) {
  list.push(i)
}

const serializedList = exampleType.serialize(list)
const deserializedList = exampleType.deserialize(serializedList)
const tree = exampleType.struct_convertToTree(deserializedList)
const values = exampleType.tree_getValues(tree)

const getProof = (value: number) => {
  const idx = values.indexOf(value)
  const chunkSize = 256 / valueType.byteLength
  const chunk = Math.floor(idx/chunkSize)
  const gIndex = exampleType.getGindexAtChunkIndex(chunk)
  return tree.getSingleProof(gIndex).map((p) => {
    return ssz.toHexString(p)
  })
}

const proof1 = getProof(list[24])
const proof2 = getProof(deserializedList[24])
// const proof3 = getProof(list[25])
// const proof4 = getProof(deserializedList[25])
// const proof5 = getProof(list[26])
// const proof6 = getProof(deserializedList[26])
// const equal = proof1.every((val, index) => val === proof2[index])
// const gIndices = list.map((l) => {
//   const i = values.indexOf(l)
//   const g = exampleType.getGindexAtChunkIndex(i)
//   return g
// })

const chunkCount = exampleType.tree_getChunkCount(tree)

const run = () => {
  console.log(list)
  console.log(deserializedList)
  console.log(values)
  // console.log(proof1)
  // console.log(proof2)
  // console.log(proof3)
  // console.log(proof4)
  // console.log(proof5)
  // console.log(proof6)
  // console.log(equal)
  // console.log(exampleType.tree_getLeafGindices(tree))
  // console.log(gIndices)
  // console.log(list.length)
  // console.log(chunkCount)
}

run()

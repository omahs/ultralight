import * as ssz from '@chainsafe/ssz'

const valueType = new ssz.Number64UintType()
const exampleType = new ssz.ListType({ elementType: valueType, limit: 250 })

const length = Math.random() * 250
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
  const gIndex = exampleType.getGindexAtChunkIndex(idx)
  return tree.getSingleProof(gIndex).map((p) => {
    return ssz.toHexString(p)
  })
}

const proof1 = getProof(list[1])
const proof2 = getProof(deserializedList[1])
const equal = proof1.every((val, index) => val === proof2[index])

const run = () => {
  console.log(list)
  console.log(deserializedList)
  console.log(values)
  console.log(proof1)
  console.log(proof2)
  console.log(equal)
}

run()

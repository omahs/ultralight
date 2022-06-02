#!/bin/sh
set -e

NODES=10
PKS=(
"CAISIMfXlQvFEQRy5LvrFZX3XFOVBeRk++Nkm2xpEdFgulJW"
"CAISIHK7a/U6jzV58HyDR1v+BLe27GvNRRhW+3TEmxIiTTAL"
"CAISIM4pIurwgfAqtkiOyNh/0vvIsU2bDhs4EnFJmpvbz4C3"
"CAISIAaFKABZmS7fmo+yut6scz1ONdzLiIDqCT1cpBA1ONBU"
"CAISIAFoEBNwo5O4pSS99sjIx7UUcf4lzcEiNqGfArOJOwBk"
"CAISIM1KfnelD19+DyTZvK/w3SJcO55FsXXuJLE97xhrTL0e"
"CAISIMD9eryXKum8cuWfr6jO+CZGCJTIBVNrzvwbD4HNtc0x"
"CAISILj15s/gZc2fmi/1cD3cij+e+RjY25vvfCiLWBjTmdeA"
"CAISIPSlX/YY5lSaYjpZWBtM7R+7K4WM4oMZ3jqxY8B288jN"
"CAISIPktpJFR8KOEdlHkuooSJiT3svIbTu8PD+cTw7XkthG2"
)
usage() {
    echo 'Usage: ./testnet.sh'
}

counter=1
while [ $counter -le $NODES ]
do
  port=$((8545+$counter))
  udp=$((5500 + $counter))
  metrics=$((18545 + $counter))
  node dist/index.js  --pk=${PKS[$counter - 1]} --rpc=true --rpcPort=$port --metrics=true --metricsPort=$metrics --bindAddress=127.0.0.1:$udp &
  counter=$(($counter+1))
done

sleep infinity

trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT
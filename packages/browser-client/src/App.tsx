import * as React from 'react'
import {
  theme,
  useClipboard,
  Button,
  useDisclosure,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  Box,
  Heading,
  Center,
  VStack,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  Divider,
} from '@chakra-ui/react'
import {
  getHistoryNetworkContentId,
  PortalNetwork,
  reassembleBlock,
  SubprotocolIds,
  ENR,
  fromHexString,
  log2Distance,
} from 'portalnetwork'
import { Block } from '@ethereumjs/block'
import DevTools from './Components/DevTools'
import StartNode from './Components/StartNode'
import Layout from './Components/Layout'
import { Capacitor } from '@capacitor/core'
import { HamburgerIcon } from '@chakra-ui/icons'
import Footer from './Components/Footer'
import InfoMenu from './Components/InfoMenu'
import { addToIndexedDB, saveToLocalStorage } from './Components/localStorage'
// export const lightblue = '#bee3f8'
export const lightblue = theme.colors.blue[100]
export const mediumblue = theme.colors.blue[200]

export const App = () => {
  const [portal, setPortal] = React.useState<PortalNetwork>()
  const [IDB, setIDB] = React.useState<IDBDatabase>()
  const [peers, setPeers] = React.useState<ENR[] | undefined>([])
  const [sortedDistList, setSortedDistList] = React.useState<[number, string[]][]>([])
  const [enr, setENR] = React.useState<string>('')
  const [id, _setId] = React.useState<string>('')
  const [peerEnr, setPeerEnr] = React.useState('')
  const [contentKey, setContentKey] = React.useState<string>(
    '0xf37c632d361e0a93f08ba29b1a2c708d9caa3ee19d1ee8d2a02612bffe49f0a9'
  )
  const [proxy, setProxy] = React.useState('ws://127.0.0.1:5050')
  const [block, setBlock] = React.useState<Block | undefined>()
  const { onCopy } = useClipboard(enr)
  const { onOpen } = useDisclosure()
  const disclosure = useDisclosure()
  // const toast = useToast()
  const [modalStatus, setModal] = React.useState(false)

  function updateAddressBook() {
    const routingTable = portal?.routingTables.get(SubprotocolIds.HistoryNetwork)
    const known = routingTable?.values()
    const formattedKnown = known!.map((_enr: ENR) => {
      const distToSelf = log2Distance(id, _enr.nodeId)
      return [
        distToSelf,
        `${_enr.ip}`,
        `${_enr.getLocationMultiaddr('udp')?.nodeAddress().port}`,
        _enr.nodeId,
        _enr.encodeTxt(),
      ]
    })
    //@ts-ignore
    const sorted = formattedKnown.sort((a, b) => a[0] - b[0]) //@ts-ignore
    const table: [number, string[]][] = sorted.map((d) => {
      return [d[0], [d[1], d[2], d[3], d[4]]]
    })
    setSortedDistList(table)
    const peers = portal!.routingTables.get(SubprotocolIds.HistoryNetwork)!.values()
    setPeers(peers)
  }

  React.useEffect(() => {
    if (portal && IDB) {
      portal.on('NodeRemoved', (nodeId) => {
        const req = IDB.transaction('peers', 'readwrite').objectStore('peers').delete(nodeId)
        req.onsuccess = () => {}
        req.onerror = () => {}
      })
      updateAddressBook()

    return () => {
      portal?.removeAllListeners()
      portal?.client.removeAllListeners()
    }
    }
  }, [portal, IDB])

  async function create() {
    const node = Capacitor.isNativePlatform()
      ? await PortalNetwork.createMobilePortalNetwork('0.0.0.0:0')
      : await PortalNetwork.createPortalNetwork('127.0.0.1', proxy)
    // eslint-disable-next-line no-undef
    ;(window as any).portal = node
    setPortal(node)
    node.client.on('multiaddrUpdated', () =>
      setENR(node.client.enr.encodeTxt(node.client.keypair.privateKey))
    )
    await node.start()
    // eslint-disable-next-line no-undef
    ;(window as any).ENR = ENR
    node.enableLog('*ultralight*, *portalnetwork*, *<uTP>*, *discv*')
  }

  const init = async () => {
    if (navigator.storage && navigator.storage.persist)
      navigator.storage.persist().then(function (persistent) {
        if (persistent) console.log('Storage will not be cleared except by explicit user action')
        else console.log('Storage may be cleared by the UA under storage pressure.')
      })

    const _IDB = window.indexedDB.open('UltralightIndexedDB', 4)
    _IDB.onupgradeneeded = () => {
      const db = _IDB.result
      if (!db.objectStoreNames.contains('peers')) {
        db.createObjectStore('peers')
      }
      if (!db.objectStoreNames.contains('headers')) {
        db.createObjectStore('headers')
      }
      if (!db.objectStoreNames.contains('blocks')) {
        db.createObjectStore('blocks')
      }
      if (!db.objectStoreNames.contains('peerid')) {
        db.createObjectStore('peerid')
      }
    }
    _IDB.onsuccess = () => {
      setIDB(_IDB.result)
      ;(window as any).IDB = _IDB.result
      const request = _IDB.result
        .transaction('peerid', 'readonly')
        .objectStore('peerid')
        .get('stored_peerid')
      request.onsuccess = async () => {
        const pid: PeerId = await PeerId.createFromJSON(request.result)
        console.log(`found PeerId ${pid}`)
        if (PeerId.isPeerId(pid)) {
          const enrRequest = _IDB.result
            .transaction('peerid', 'readonly')
            .objectStore('peerid')
            .get('stored_enr')
          enrRequest.onsuccess = async () => {
            const e = enrRequest.result
            console.log(`Found stored ${e}`)
            const n = await PortalNetwork.recreatePortalNetwork('127.0.0.1', proxy, pid, e)
            const id = await n.client.peerId()
            const _enr = n.client.enr.encodeTxt(n.client.keypair.privateKey)
            console.log(`recreated portal client with peerid: ${id} and ${_enr}`)
            ;(window as any).portal = n
            setPortal(n)
            n.client.on('multiaddrUpdated', () =>
              setENR(n.client.enr.encodeTxt(n.client.keypair.privateKey))
            )
            const sessionReq = _IDB.result
              .transaction('session', 'readonly')
              .objectStore('session')
              .get('saved_session')
            sessionReq!.onsuccess = () => {
              console.log('Found saved session')
              const sesh = sessionReq.result
              console.log(sesh)
    }
            await n.start()
            // eslint-disable-next-line no-undef
            ;(window as any).ENR = ENR
            n.enableLog('*ultralight*, *portalnetwork*, *<uTP>*, *discv*')
    }
          enrRequest.onerror = async () => {
            console.log(`found invalid PeerId`)
            await create()
          }
        } else {
          console.log(`found invalid PeerId`)
          await create()
        }
      }
      request.onerror = async () => {
        console.log(`peerId not found`)
    const node = Capacitor.isNativePlatform()
      ? await PortalNetwork.createMobilePortalNetwork('0.0.0.0:0')
      : await PortalNetwork.createPortalNetwork('127.0.0.1', proxy)
    // eslint-disable-next-line no-undef
    ;(window as any).portal = node
    setPortal(node)
    node.client.on('multiaddrUpdated', () =>
      setENR(node.client.enr.encodeTxt(node.client.keypair.privateKey))
    )
    await node.start()
    // eslint-disable-next-line no-undef
    ;(window as any).ENR = ENR
    node.enableLog('*ultralight*, *portalnetwork*, *<uTP>*, *discv*')
      }
    }
  }

  const copy = async () => {
    await setENR(portal?.client.enr.encodeTxt(portal.client.keypair.privateKey) ?? '')
    onCopy()
  }

  React.useEffect(() => {
    init()
  }, [])

  async function handleClick() {
    let errMessage
    try {
      await portal?.sendPing(peerEnr, SubprotocolIds.HistoryNetwork)
    } catch (err) {
      if ((err as any).message.includes('verify enr signature')) {
        errMessage = 'Invalid ENR'
      }
    }
    setPeerEnr('')
    updateAddressBook()
    // Only rerender the address book if we actually got a response from the node

    if (!errMessage) {
      errMessage = 'Node did not respond'
    }
    // toast({
    //   title: errMessage,
    //   status: 'error',
    //   duration: 3000,
    //   isClosable: true,
    // })
  }

  async function handleFindContent(blockHash: string): Promise<Block | void> {
    if (portal) {
      if (blockHash.slice(0, 2) !== '0x') {
        setContentKey('')
      } else {
        try {
          const headReq = IDB?.transaction('headers', 'readonly')
            .objectStore('headers')
            .get(blockHash)
          headReq!.onsuccess = () => {
            const savedHeader = headReq!.result
            const bodyReq = IDB?.transaction('blocks', 'readonly')
              .objectStore('blocks')
              .get(blockHash)
            bodyReq!.onsuccess = async () => {
              const savedBody = bodyReq?.result
              try {
                const b = reassembleBlock(fromHexString(savedHeader), fromHexString(savedBody))
                console.log('Found block in indexeddb')
                setBlock(b)
                return b
              } catch {
                console.log('Block not in indexeddb')

        const headerlookupKey = getHistoryNetworkContentId(1, blockHash, 0)
        const bodylookupKey = getHistoryNetworkContentId(1, blockHash, 1)
                let header: string = ''
                let body
                await portal.historyNetworkContentLookup(0, blockHash)
                try {
                  header = await portal.db.get(headerlookupKey)
                } catch (err) {
                  portal.logger((err as any).message)
                }
                await portal.historyNetworkContentLookup(1, blockHash)
                try {
                  body = await portal.db.get(bodylookupKey)
                } catch (err) {
                  portal.logger((err as any).message)
                }
                try {
                  const block = reassembleBlock(
                    fromHexString(header),
                    typeof body === 'string' ? fromHexString(body) : body
                  )
                  const request = IDB!
                    .transaction('blocks', 'readwrite')
                    .objectStore('blocks')
                    .put(body, blockHash)
                  request!.onsuccess = () => {
                    const req = IDB!
                      .transaction('headers', 'readwrite')
                      .objectStore('headers')
                      .put(header, blockHash)
                    req.onsuccess = () => {}
                    req.onerror = () => {
                      console.log(`FAILED ${blockHash} not added to indexeddb`)
                    }
                  }
                  request!.onerror = () => {
                    console.log(`error adding block to indexeddb`)
                  }
                  setBlock(block)
                  return block
                } catch (err) {
                  portal.logger((err as any).message)
                }
              }
            }
          }
          headReq!.onerror = () => {
            throw new Error()
          }
        } catch {
          const headerlookupKey = getHistoryNetworkContentId(1, blockHash, 0)
          const bodylookupKey = getHistoryNetworkContentId(1, blockHash, 1)
          let header: string = ''
        let body
        await portal.historyNetworkContentLookup(0, blockHash)
        try {
          header = await portal.db.get(headerlookupKey)
        } catch (err) {
          portal.logger((err as any).message)
        }
        await portal.historyNetworkContentLookup(1, blockHash)
        try {
          body = await portal.db.get(bodylookupKey)
        } catch (err) {
          portal.logger((err as any).message)
        }
        try {
          const block = reassembleBlock(
            fromHexString(header),
            typeof body === 'string' ? fromHexString(body) : body
          )
            const request = IDB!
              .transaction('blocks', 'readwrite')
              .objectStore('blocks')
              .put(body, blockHash)
            request!.onsuccess = () => {
              const req = IDB!
                .transaction('headers', 'readwrite')
                .objectStore('headers')
                .put(header, blockHash)
              req.onsuccess = () => {}
              req.onerror = () => {}
            }
            request!.onerror = () => {}
          setBlock(block)
          return block
        } catch (err) {
          portal.logger((err as any).message)
        }
      }
    }
  }
  }

  async function findParent(hash: string) {
    setContentKey(hash)
    handleFindContent(hash)
    portal?.logger('Showing Block')
  }

  const openInfoMenu = () => {
    setModal(true)
    disclosure.onClose()
  }
  const invalidHash = /([^0-z])+/.test(contentKey)

  React.useEffect(() => {
    if (peers && peers.length > 0) {
      try {
        peers?.forEach(async (peer) => {
          addToIndexedDB('peers', peer.nodeId, peer.encodeTxt(), IDB!)
        })
        const req = IDB?.transaction('peers', 'readwrite').objectStore('peers').getAllKeys()
        req!.onsuccess = () => {
          const indexed = req!.result
          const nodeIds = peers?.map((p) => {
            return p.nodeId
          })
          indexed.forEach((p) => {
            if (!nodeIds?.includes(p as string)) {
              IDB && removeFromIndexedDB('peers', p as string, IDB)
            }
          })
        }
      } catch {}
    }
  }, [peers])

  return (
    <>
      <Center bg={'gray.200'}>
        <VStack width={'80%'}>
          <Heading size={'2xl'} textAlign="start">
            Ultralight
          </Heading>
          <Heading size={'l'} textAlign="start">
            Portal Network Explorer
          </Heading>
        </VStack>
      </Center>
      <Button
        position="fixed"
        top="5"
        right="5"
        leftIcon={<HamburgerIcon />}
        onClick={disclosure.onOpen}
      ></Button>
      <Drawer isOpen={disclosure.isOpen} placement="right" onClose={disclosure.onClose}>
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>Ultralight</DrawerHeader>
          <DrawerBody>
            <Button w="100%" mb="5px" onClick={openInfoMenu}>
              More Info
            </Button>
            {!Capacitor.isNativePlatform() && (
              <>
                <Divider my="10px" />
                <StartNode setProxy={setProxy} init={init} />
              </>
            )}
            <Divider my="10px" />
            <DevTools
              peerEnr={peerEnr}
              setPeerEnr={setPeerEnr}
              native={Capacitor.isNativePlatform()}
              enr={enr}
              copy={copy}
              portal={portal}
              peers={peers!}
              handleClick={handleClick}
            />
          </DrawerBody>
          <DrawerFooter>
            <Button onClick={disclosure.onClose}>CLOSE</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <Box>
        {IDB && (
          <Layout
            copy={copy}
            onOpen={onOpen}
            enr={enr}
            peerEnr={peerEnr}
            setPeerEnr={setPeerEnr}
            handleClick={handleClick}
            invalidHash={invalidHash}
            handleFindContent={handleFindContent}
            contentKey={contentKey}
            setContentKey={setContentKey}
            findParent={findParent}
            block={block}
            peers={peers}
            IDB={IDB}
            sortedDistList={sortedDistList}
            capacitor={Capacitor}
          />
        )}
        <Button onClick={() => updateAddressBook()}>Update Address Book</Button>
      </Box>
      <Box width={'100%'} pos={'fixed'} bottom={'0'}>
        <Center>
          <Footer />
        </Center>
      </Box>
      <Modal isOpen={modalStatus} onClose={() => setModal(false)}>
        <ModalOverlay />
        <ModalContent>
          <InfoMenu />
        </ModalContent>
      </Modal>
    </>
  )
}

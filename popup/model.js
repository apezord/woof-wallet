const { Address, PrivateKey, Transaction } = require("bitcore-lib")
const Mnemonic = require('bitcore-mnemonic')


Transaction.DUST_AMOUNT = 1000000

const DERIVATION = "m/44'/3'/0'/0/0"
const NUM_RETRIES = 3


class Model {
    constructor() {
        this.hasAllPermissions = undefined
        this.credentials = undefined
        this.acceptedTerms = undefined
        this.numUnconfirmed = undefined
        this.utxos = undefined
        this.inscriptions = undefined
    }


    async requestPermissions() {
        await browser.permissions.request({ origins: ["*://dogechain.info/*", "*://doginals.com/*", "*://api.blockchair.com/*"] })

        await this.loadPermissions()

        if (!this.hasAllPermissions) {
            throw new Error('necessary permissions not granted')
        }
    }


    async loadPermissions() {
        const permissions = await browser.permissions.getAll()

        if (!permissions.origins.includes("*://dogechain.info/*")) {
            this.hasAllPermissions = false
            return
        }

        if (!permissions.origins.includes("*://doginals.com/*")) {
            this.hasAllPermissions = false
            return
        }

        if (!permissions.origins.includes("*://api.blockchair.com/*")) {
            this.hasAllPermissions = false
            return
        }

        this.hasAllPermissions = true
    }

    async load() {
        await this.loadPermissions()

        const values = await browser.storage.local.get(["privkey", "mnemonic", "derivation", "accepted_terms", "utxos"])

        if (values.privkey) {
            this.credentials = {
                privateKey: new PrivateKey(values.privkey),
                mnemonic: values.mnemonic && new Mnemonic(values.mnemonic),
                derivation: values.derivation
            }
        }

        this.acceptedTerms = values.accepted_terms

        this.utxos = values.utxos
    }


    async acceptTerms() {
        await browser.storage.local.set({ accepted_terms: true })
        this.acceptedTerms = true
    }


    generateRandomCredentials() {
        const mnemonic = new Mnemonic(Mnemonic.Words.ENGLISH);
        const privateKey = mnemonic.toHDPrivateKey().deriveChild(DERIVATION).privateKey
        return { privateKey, mnemonic, derivation: DERIVATION }
    }


    createCredentialsFromMnemonic(mnemonicText) {
        const mnemonic = new Mnemonic(mnemonicText);
        const privateKey = mnemonic.toHDPrivateKey().deriveChild(DERIVATION).privateKey
        return { privateKey, mnemonic, derivation: DERIVATION }
    }


    createCredentialsFromPrivateKey(privateKeyWIF) {
        const privateKey = new PrivateKey(privateKeyWIF);
        return { privateKey, mnemonic: null, derivation: null }
    }


    async storeCredentials(credentials) {
        await browser.storage.local.set({
            privkey: credentials.privateKey.toWIF(),
            mnemonic: credentials.mnemonic && credentials.mnemonic.toString(),
            derivation: credentials.derivation
        })

        this.credentials = credentials
    }


    async refreshUtxos() {
        let utxos = []
        let round = 1
        let done = false

        while (!done) {
            for (let retry = 0; retry < NUM_RETRIES; retry++) {
                try {
                    // query latest utxos
                    const address = this.credentials.privateKey.toAddress().toString()
                    const resp = await fetch(`https://dogechain.info/api/v1/address/unspent/${address}/${round}`)
                    const json = await resp.json()
                    if (!json.success) throw new Error('dogechain.info error')

                    // convert response to our utxo format
                    const partial_utxos = json.unspent_outputs.map(unspent_output => {
                        return {
                            txid: unspent_output.tx_hash,
                            vout: unspent_output.tx_output_n,
                            script: unspent_output.script,
                            satoshis: unspent_output.value,
                            confirmations: unspent_output.confirmations
                        }
                    })

                    if (partial_utxos.length == 0) {
                        done = true
                    }

                    partial_utxos.forEach(utxo => utxos.push(utxo))

                    round += 1
                    break
                }
                catch (e) {
                    console.error(e)
                    if (retry == NUM_RETRIES - 1) throw e
                }
            }
        }

        // sort in order of newest to oldest
        utxos.sort((a, b) => (a.confirmations || 0) - (b.confirmations || 0))

        // log the utxos
        console.log('utxos:')
        utxos.forEach(utxo => {
            console.log(utxo.txid + ":" + utxo.vout + ` (sats=${utxo.satoshis} confs=${utxo.confirmations})`)
        })

        // filter out unconfirmed because they wont be indexed
        const unconfirmedUtxos = utxos.filter(x => !x.confirmations)
        const confirmedUtxos = utxos.filter(x => x.confirmations > 0)

        this.numUnconfirmed = unconfirmedUtxos.length
        this.utxos = confirmedUtxos

        // check if these utxos are the same
        if (JSON.stringify(confirmedUtxos) == JSON.stringify(this.utxos)) {
            return
        }

        // check that the utxos are in sync with indexer
        const resp2 = await fetch("https://dogechain.info/api/v1/block/besthash")
        const json2 = await resp2.json()
        if (!json2.success) throw new Error('bad request')
        const resp3 = await fetch(`https://doginals.com/block/${json2.hash}`)
        if (resp3.status != 200) throw new Error("doginals.com is out of sync")
        
        // save them for next time
        await browser.storage.local.set({ utxos: confirmedUtxos })
    }


    async refreshDoginals() {
        const { inscriptionIds, inscriptionOutpoints } = await this.refreshInscriptionIds()

        await this.refreshInscriptionContent(inscriptionIds, inscriptionOutpoints)

        console.log('inscriptions:', this.inscriptions)
    }


    async refreshInscriptionIds() {
        // read the inscriptions we have for each output
        const keys = this.utxos.map(utxo => `inscriptions_at_${utxo.txid}:${utxo.vout}`)
        const inscriptionIdsPerOutput = await browser.storage.local.get(keys)
        const allInscriptionIds = []
        const inscriptionOutpoints = []

        // if are missing any, download them
        for (const utxo of this.utxos) {
            const key = `inscriptions_at_${utxo.txid}:${utxo.vout}`

            if (!inscriptionIdsPerOutput[key]) {
                const resp = await fetch(`https://doginals.com/output/${utxo.txid}:${utxo.vout}`)
                const html = await resp.text()

                const parser = new DOMParser()
                const doc = parser.parseFromString(html, 'text/html')
                const main = doc.getElementsByTagName("main")[0]
                const list = main.getElementsByTagName("dl")[0]
                const thumbnails = Array.from(list.getElementsByTagName("dd")).filter(x => x.className == "thumbnails")
                const inscriptionIds = thumbnails.map(x => x.getElementsByTagName("a")[0].getAttribute("href").split("/shibescription/")[1])

                inscriptionIdsPerOutput[key] = inscriptionIds
                inscriptionIds.forEach(x => {
                    allInscriptionIds.push(x)
                    inscriptionOutpoints.push(`${utxo.txid}:${utxo.vout}`)
                })

                if (inscriptionIds.length || utxo.confirmations > 10) {
                    await browser.storage.local.set({ [key]: inscriptionIds })
                }
            } else {
                inscriptionIdsPerOutput[key].forEach(x => {
                    allInscriptionIds.push(x)
                    inscriptionOutpoints.push(`${utxo.txid}:${utxo.vout}`)
                })
            }
        }

        return { inscriptionIds: allInscriptionIds, inscriptionOutpoints }
    }


    async refreshInscriptionContent(inscriptionIds, inscriptionOutpoints) {
        const keys = inscriptionIds.map(x => `inscription_${x}`)
        const inscriptions = await browser.storage.local.get(keys)

        // download missing content
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]

            if (!inscriptions[key]) {
                const inscriptionId = inscriptionIds[i]
                const url = `https://doginals.com/content/${inscriptionId}`
                const resp = await fetch(url)
                const blob = await resp.blob()
                const data = await new Promise((resolve) => {
                    const reader = new FileReader()
                    reader.onload = function() { resolve(this.result) }
                    reader.readAsDataURL(blob);
                })

                const url2 = `https://doginals.com/shibescription/${inscriptionId}`
                const resp2 = await fetch(url2)
                const html = await resp2.text()

                const parser = new DOMParser()
                const doc = parser.parseFromString(html, 'text/html')
                const main = doc.getElementsByTagName("main")[0]
                const h1 = main.getElementsByTagName("h1")[0]
                const number = h1.innerHTML.split(" ")[1]

                const inscription = {
                    id: inscriptionId,
                    data,
                    outpoint: inscriptionOutpoints[i],
                    number
                }
                inscriptions[key] = inscription
                await browser.storage.local.set({ [key]: inscription })
            }
        }

        this.inscriptions = inscriptions
    }

    async sendDoginal(inscription, address) {
        let countInOutput = 0;
        for (const entry of Object.values(this.inscriptions)) {
            if (entry.outpoint == inscription.outpoint) {
                countInOutput++
            }
        }
        if (countInOutput == 0) throw new Error("inscription not found")
        if (countInOutput > 1) throw new Error("multi-doginal outputs not supported")

        const inscriptionUtxo = this.utxos.filter(x => `${x.txid}:${x.vout}` == inscription.outpoint)[0]
        if (!inscriptionUtxo) throw new Error("inscription utxo not found")

        const change = model.credentials.privateKey.toAddress().toString()

        const fundingUtxos = this.utxos.filter(x => {
            return !Object.values(this.inscriptions).find(y => y.outpoint == `${x.txid}:${x.vout}`)
        })

        const tx = new Transaction()
        tx.from(inscriptionUtxo)
        tx.from(fundingUtxos)
        tx.to(address, Transaction.DUST_AMOUNT)
        tx.change(change)
        tx.sign(model.credentials.privateKey)
        tx.toString()

        if (tx.inputAmount < tx.outputAmount) {
            throw new Error("Not enough funds")
        }

        console.log("funding utxos:", fundingUtxos)
        console.log("tx:", tx.toJSON())

        const resp = await fetch("https://api.blockchair.com/dogecoin/push/transaction", {
            method: "POST",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: tx.toString()
            })
        })

        if (resp.status != 200) {
            let json
            try {
                json = await resp.json()
            } catch {
                throw new Error(resp.status.toString() + ": " + resp.statusText)
            }

            if (json.context && json.context.error) {
                throw new Error(json.context.error)
            } else {
                throw new Error(resp.status.toString() + ": " + resp.statusText)
            }
        }

        return tx.hash
    }
}


window.model = new Model()
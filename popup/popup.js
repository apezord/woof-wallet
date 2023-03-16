const Buffer = require('bitcore-lib').deps.Buffer
const $ = document.querySelector.bind(document)
const $$ = document.querySelectorAll.bind(document)

window.onerror = message => showErrorPage(message)
window.addEventListener("unhandledrejection", event => showErrorPage(event.reason.message))


model.load().then(reloadWallet)


function reloadWallet() {
    if (!model.hasAllPermissions) {
        showGrantPermissionsPage()
    } else if (!model.acceptedTerms) {
        showAcceptTermsPage()
    } else if (model.credentials) {
        showViewWalletPage()
    } else {
        showSetupPage()
    }
}


function showGrantPermissionsPage() {
    showPage("grant_permissions_page")

    $("#accept_permissions_button").onclick = async () => {
        await model.requestPermissions()
        reloadWallet()
    }
}


function showAcceptTermsPage() {
    showPage("accept_terms_page")

    $("#accept_terms_button").onclick = async () => {
        await model.acceptTerms()
        reloadWallet()
    }
}


function showSetupPage() {
    showPage("setup_page")

    $("#new_wallet_button").onclick = showCreateWalletPage
    $("#import_wallet_button").onclick = showImportWalletPage
}


function showCreateWalletPage() {
    showPage("create_page")

    const credentials = model.generateRandomCredentials()

    $("#mnemonic").innerHTML = credentials.mnemonic.toString()

    $("#create_wallet_ok_button").onclick = async () => {
        await model.storeCredentials(credentials)
        showViewWalletPage()
    }
}


function showImportWalletPage() {
    showPage("import_page")

    $("#import_private_key_button").onclick = showImportPrivateKeyPage
    $("#import_twelve_words_button").onclick = showImportTwelveWordsPage
}


function showImportPrivateKeyPage() {
    showPage("import_private_key_page")

    $("#private_key_textarea").focus()

    $("#private_key_textarea").oninput = () => {
        const keyText = $("#private_key_textarea").value
        try {
            if (!keyText) throw new Error()
            new PrivateKey(keyText)
            $("#load_private_key_button").disabled = false
        } catch (e) {
            $("#load_private_key_button").disabled = true
        }
    }

    $("#load_private_key_button").onclick = async () => {
        const keyText = $("#private_key_textarea").value
        const credentials = model.createCredentialsFromPrivateKey(keyText)
        await model.storeCredentials(credentials)
        showViewWalletPage()
    }
}


function showImportTwelveWordsPage() {
    showPage("import_twelve_words_page")

    $("#twelve_words_textarea").focus()
    $("#load_twelve_words_button").disabled = true

    $("#twelve_words_textarea").oninput = () => {
        const wordsText = $("#twelve_words_textarea").value
        try {
            if (!wordsText) throw new Error()
            new Mnemonic(wordsText)
            $("#load_twelve_words_button").disabled = false
        } catch (e) {
            $("#load_twelve_words_button").disabled = true
        }
    }

    $("#load_twelve_words_button").onclick = async () => {
        const wordsText = $("#twelve_words_textarea").value
        const credentials = model.createCredentialsFromMnemonic(wordsText)
        await model.storeCredentials(credentials)
        showViewWalletPage()
    }
}


function showViewWalletPage() {
    showPage("view_wallet_page")

    const address = model.credentials.privateKey.toAddress().toString()

    $("#copy_address_button").onclick = () => navigator.clipboard.writeText(address)

    $("#address").innerHTML = address

    model.refreshUtxos().then(() => {
        let balance = model.utxos.reduce((prev, curr) => prev + curr.satoshis, 0) / 100000000;
        $("#doge_balance").innerHTML = `${balance} DOGE`

        model.refreshDoginals().then(() => {
            if (Object.keys(model.inscriptions).length) {
                $("#doginals").innerHTML = ""

                if (model.numUnconfirmed > 0) {
                    const pending = document.createElement("div")
                    pending.classList.add("pending")
                    const suf = model.numUnconfirmed > 1 ? 's' : ''
                    pending.innerHTML = `${model.numUnconfirmed} unconfirmed transaction${suf}...`
                    $("#doginals").appendChild(pending)
                }

                let row;
                let i = 0;

                for (const inscription of Object.values(model.inscriptions)) {
                    if (!row) {
                        row = document.createElement("div")
                        row.classList.add("doginals_row")
                        spacer = document.createElement("div")
                        spacer.classList.add("doginals_row_spacer")
                        row.appendChild(spacer)
                        $("#doginals").appendChild(row)
                    }

                    const doginal = document.createElement("div")
                    doginal.classList.add("doginal")
                    doginal.classList.remove("inscription_text")
                    if (inscription.data.toLowerCase().startsWith("data:image/")) {
                        doginal.style.backgroundImage = `url(${inscription.data})`
                        if (inscription.data.length < 3000) {
                            doginal.style.imageRendering = "pixelated"
                        }
                    } else if (inscription.data.toLowerCase().startsWith("data:text")) {
                        let parts = inscription.data.slice(5).split(";")
                        let base64text = parts[parts.length - 1]
                        if (base64text.startsWith("base64,")) base64text = base64text.slice("base64,".length)
                        let text = Buffer.from(base64text, 'base64').toString('utf8')
                        doginal.innerHTML = text
                        doginal.classList.add("inscription_text")
                    } else {
                        doginal.innerHTML = inscription.data.slice(5).split(";")[0]
                    }
                    doginal.onclick = function() { showViewDoginalPage(inscription.id) }
                    row.appendChild(doginal)

                    if (i % 2 == 1) {
                        spacer = document.createElement("div")
                        spacer.classList.add("doginals_row_spacer")
                        row.appendChild(spacer)
                        row = null
                    }

                    i++
                }
            } else {
                $("#doginals").innerHTML = ""

                if (model.numUnconfirmed > 0) {
                    const pending = document.createElement("div")
                    pending.classList.add("pending")
                    const suf = model.numUnconfirmed > 1 ? 's' : ''
                    pending.innerHTML = `${model.numUnconfirmed} unconfirmed transaction${suf}...`
                    $("#doginals").appendChild(pending)
                } else {
                    $("#doginals").innerHTML = "No doginals"
                }
            }
        })
    })
}


async function showViewDoginalPage(inscriptionId) {
    const key = `inscription_${inscriptionId}`

    showPage("view_doginal_page")

    $("#doginal_send_button").onclick = async () => {
        $("#doginal_address_input").disabled = true
        $("#doginal_send_button").disabled = true

        const address = $("#doginal_address_input").value
        const inscription = (await browser.storage.local.get(key))[key]

        const txid = await model.sendDoginal(inscription, address)

        showSentPage(txid)
    }

    $("#doginal_address_input").oninput = () => {
        try {
            const address = $("#doginal_address_input").value
            if (!address.length) throw new Error()
            new Address(address)
            $("#doginal_send_button").disabled = false
        } catch {
            $("#doginal_send_button").disabled = true
        }
    }

    const inscription = (await browser.storage.local.get([key]))[key]

    $("#doginal_send_button").disabled = true
    $("#doginal_inscription_number").innerHTML = "Shibescription " + inscription.number
    $("#doginal_inscription_number").onclick = () => window.open(`https://doginals.com/shibescription/${inscriptionId}`)

    $("#doginal_content").classList.remove("inscription_text")
    if (inscription.data.toLowerCase().startsWith("data:image/")) {
        $("#doginal_content").style.backgroundImage = `url(${inscription.data})`
        if (inscription.data.length < 3000) {
            $("#doginal_content").style.imageRendering = "pixelated"
        }
    } else if (inscription.data.toLowerCase().startsWith("data:text")) {
        let parts = inscription.data.slice(5).split(";")
        let base64text = parts[parts.length - 1]
        if (base64text.startsWith("base64,")) base64text = base64text.slice("base64,".length)
        let text = Buffer.from(base64text, 'base64').toString('utf8')
        $("#doginal_content").innerHTML = text
        $("#doginal_content").classList.add("inscription_text")
    } else {
        const contentType = inscription.data.slice(5).split(";")[0]
        $("#doginal_content").innerHTML = contentType
    }
}


async function showSentPage(txid) {
    showPage("sent_page")
    $("#sent_txid").innerHTML = txid
    $("#sent_message").innerHTML = "Sent"
}

function showErrorPage(message) {
    showPage("error_page")
    $("#error_message").innerHTML = message
}


function showPage(page) {
    $$(".page").forEach(element => element.style.display = "none")
    $("#" + page).style.display = "flex"
}

const $ = document.querySelector.bind(document)
const $$ = document.querySelectorAll.bind(document)


$("#reset_button").disabled = true
$("#accept_reset_checkbox").onclick = clickAcceptReset
$("#reset_button").onclick = resetWallet


async function loadWallet() {
    const values = await browser.storage.local.get(["privkey", "mnemonic", "derivation"])

    $("#privkey").value = values.privkey || null
    $("#mnemonic").value = values.mnemonic || null
    $("#derivation").value = values.derivation || null

    $("#privkey").disabled = true
    $("#mnemonic").disabled = true
    $("#derivation").disabled = true
}


function clickAcceptReset() {
    if ($("#accept_reset_checkbox").checked) {
        $("#reset_button").disabled = false
    } else {
        $("#reset_button").disabled = true
    }
}


async function resetWallet() {
    await browser.storage.local.clear();
    $("#privkey").value = null
    $("#mnemonic").value = null
    $("#derivation").value = null
    $("#accept_reset_checkbox").checked = false
    $("#reset_button").disabled = true
}


loadWallet().catch(e => console.error(e))
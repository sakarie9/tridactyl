/** Script used in the commandline iframe. Communicates with background. */

import * as perf from "@src/perf"
import "@src/lib/number.clamp"
import "@src/lib/html-tagged-template"
import * as Completions from "@src/completions"
import { BufferAllCompletionSource } from "@src/completions/BufferAll"
import { BufferCompletionSource } from "@src/completions/Buffer"
import { BmarkCompletionSource } from "@src/completions/Bmark"
import { ExcmdCompletionSource } from "@src/completions/Excmd"
import { FileSystemCompletionSource } from "@src/completions/FileSystem"
import { HelpCompletionSource } from "@src/completions/Help"
import { HistoryCompletionSource } from "@src/completions/History"
import { PreferenceCompletionSource } from "@src/completions/Preferences"
import { SettingsCompletionSource } from "@src/completions/Settings"
import * as Messaging from "@src/lib/messaging"
import * as Config from "@src/lib/config"
import "@src/lib/number.clamp"
import state from "@src/state"
import Logger from "@src/lib/logging"
import { theme } from "@src/content/styling"

import * as genericParser from "@src/parsers/genericmode"
import * as tri_editor from "@src/lib/editor"

const logger = new Logger("cmdline")

let activeCompletions: Completions.CompletionSource[] = undefined
let completionsDiv = window.document.getElementById(
    "completions",
) as HTMLElement
let clInput = window.document.getElementById(
    "tridactyl-input",
) as HTMLInputElement

// first theming of commandline iframe
theme(document.querySelector(":root"))

/* This is to handle Escape key which, while the cmdline is focused,
 * ends up firing both keydown and input listeners. In the worst case
 * hides the cmdline, shows and refocuses it and replaces its text
 * which could be the prefix to generate a completion.
 * tl;dr TODO: delete this and better resolve race condition
 */
let isVisible = false
function resizeArea() {
    if (isVisible) {
        Messaging.messageOwnTab("commandline_content", "show")
        Messaging.messageOwnTab("commandline_content", "focus")
        focus()
    }
}

// This is a bit loosely defined at the moment.
// Should work so long as there's only one completion source per prefix.
function getCompletion() {
    if (!activeCompletions) return undefined

    for (const comp of activeCompletions) {
        if (comp.state === "normal" && comp.completion !== undefined) {
            return comp.completion
        }
    }
}

export function enableCompletions() {
    if (!activeCompletions) {
        activeCompletions = [
            new BmarkCompletionSource(completionsDiv),
            new BufferAllCompletionSource(completionsDiv),
            new BufferCompletionSource(completionsDiv),
            new ExcmdCompletionSource(completionsDiv),
            new FileSystemCompletionSource(completionsDiv),
            new HelpCompletionSource(completionsDiv),
            new HistoryCompletionSource(completionsDiv),
            new PreferenceCompletionSource(completionsDiv),
            new SettingsCompletionSource(completionsDiv),
        ]

        const fragment = document.createDocumentFragment()
        activeCompletions.forEach(comp => fragment.appendChild(comp.node))
        completionsDiv.appendChild(fragment)
        logger.debug(activeCompletions)
    }
}
/* document.addEventListener("DOMContentLoaded", enableCompletions) */

let noblur = e => setTimeout(() => clInput.focus(), 0)

export function focus() {
    clInput.focus()
    clInput.addEventListener("blur", noblur)
}

async function sendExstr(exstr) {
    Messaging.message("commandline_background", "recvExStr", [exstr])
}

let HISTORY_SEARCH_STRING: string

/* Command line keybindings */

let keyParser = keys => genericParser.parser("exmaps", keys)
let keyEvents = []
clInput.addEventListener("keydown", function(keyevent: KeyboardEvent) {
    keyEvents.push(keyevent)
    let response = keyParser(keyEvents)
    if (response.isMatch) {
        keyevent.preventDefault()
        keyevent.stopImmediatePropagation()
    }
    if (response.exstr) {
        Messaging.message("controller_background", "acceptExCmd", [response.exstr])
    } else {
        keyEvents = response.keys
    }
}, true)

export function next_completion() {
    if (activeCompletions)
        activeCompletions.forEach(comp => comp.next())
}

export function prev_completions() {
    if (activeCompletions)
        activeCompletions.forEach(comp => comp.prev())
}

export function insert_completion() {
    const command = getCompletion()
    activeCompletions.forEach(comp => (comp.completion = undefined))
    if (command) clInput.value = clInput.value + " "
}

export function insert_completion_or_space() {
    let value = clInput.value
    insert_completion()
    // If insert_completion didn't insert anything, insert a space
    if (value == clInput.value)
        clInput.value += " "
}

let timeoutId: any = 0
let onInputPromise: Promise<any> = Promise.resolve()
clInput.addEventListener("input", () => {
    const exstr = clInput.value
    // Prevent starting previous completion computation if possible
    clearTimeout(timeoutId)
    // Schedule completion computation. We do not start computing immediately because this would incur a slow down on quickly repeated input events (e.g. maintaining <Backspace> pressed)
    let myTimeoutId = setTimeout(async () => {
        try {
            // Make sure the previous computation has ended
            await onInputPromise
        } catch (e) {
            // we don't actually care because this is the previous computation, which we will throw away
            logger.warning(e)
        }

        // If we're not the current completion computation anymore, stop
        if (timeoutId != myTimeoutId) return

        enableCompletions()
        // Fire each completion and add a callback to resize area
        onInputPromise = Promise.all(
            activeCompletions.map(comp => comp.filter(exstr).then(resizeArea))
        )
    }, 100)
    // Declare self as current completion computation
    timeoutId = myTimeoutId
})

let cmdline_history_position = 0
let cmdline_history_current = ""

/** Clears the command line.
 *  If you intend to close the command line after this, set evlistener to true in order to enable losing focus.
 *  Otherwise, no need to pass an argument.
 */
export function clear(evlistener = false) {
    if (evlistener) clInput.removeEventListener("blur", noblur)
    clInput.value = ""
    cmdline_history_position = 0
    cmdline_history_current = ""
}

export async function hide_and_clear() {
    clear(true)

    // Try to make the close cmdline animation as smooth as possible.
    Messaging.messageOwnTab("commandline_content", "hide")
    Messaging.messageOwnTab("commandline_content", "blur")
    // Delete all completion sources - I don't think this is required, but this
    // way if there is a transient bug in completions it shouldn't persist.
    if (activeCompletions)
        activeCompletions.forEach(comp => completionsDiv.removeChild(comp.node))
    activeCompletions = undefined
    isVisible = false
}

function setCursor(n = 0) {
    clInput.setSelectionRange(n, n, "none")
}

export function history(n) {
    HISTORY_SEARCH_STRING =
        HISTORY_SEARCH_STRING === undefined
            ? clInput.value
            : HISTORY_SEARCH_STRING
    let matches = state.cmdHistory.filter(key =>
        key.startsWith(HISTORY_SEARCH_STRING),
    )
    if (cmdline_history_position == 0) {
        cmdline_history_current = clInput.value
    }
    let clamped_ind = matches.length + n - cmdline_history_position
    clamped_ind = clamped_ind.clamp(0, matches.length)

    const pot_history = matches[clamped_ind]
    clInput.value =
        pot_history == undefined ? cmdline_history_current : pot_history

    // if there was no clampage, update history position
    // there's a more sensible way of doing this but that would require more programmer time
    if (clamped_ind == matches.length + n - cmdline_history_position)
        cmdline_history_position = cmdline_history_position - n
}

/* Send the commandline to the background script and await response. */
export function process() {
    const command = getCompletion() || clInput.value

    hide_and_clear()

    const [func, ...args] = command.trim().split(/\s+/)

    if (func.length === 0 || func.startsWith("#")) {
        return
    }

    // Save non-secret commandlines to the history.
    if (
        !browser.extension.inIncognitoContext &&
        !(func === "winopen" && args[0] === "-private")
    ) {
        state.cmdHistory = state.cmdHistory.concat([command])
    }
    cmdline_history_position = 0

    sendExstr(command)
}

export function fillcmdline(
    newcommand?: string,
    trailspace = true,
    ffocus = true,
) {
    if (trailspace) clInput.value = newcommand + " "
    else clInput.value = newcommand
    isVisible = true
    // Focus is lost for some reason.
    if (ffocus) {
        focus()
        clInput.dispatchEvent(new Event("input")) // dirty hack for completions
    }
}

/** Create a temporary textarea and give it to fn. Remove the textarea afterwards

    Useful for document.execCommand
*/
function applyWithTmpTextArea(fn) {
    let textarea
    try {
        textarea = document.createElement("textarea")
        // Scratchpad must be `display`ed, but can be tiny and invisible.
        // Being tiny and invisible means it won't make the parent page move.
        textarea.style.cssText =
            "visible: invisible; width: 0; height: 0; position: fixed"
        textarea.contentEditable = "true"
        document.documentElement.appendChild(textarea)
        return fn(textarea)
    } finally {
        document.documentElement.removeChild(textarea)
    }
}

export async function setClipboard(content: string) {
    applyWithTmpTextArea(scratchpad => {
        scratchpad.value = content
        scratchpad.select()
        if (document.execCommand("Copy")) {
            // // todo: Maybe we can consider to using some logger and show it with status bar in the future
            logger.info("set clipboard:", scratchpad.value)
        } else throw "Failed to copy!"
    })
    // Return focus to the document
    Messaging.messageOwnTab("commandline_content", "hide")
    Messaging.messageOwnTab("commandline_content", "blur")
}

export function getClipboard() {
    const result = applyWithTmpTextArea(scratchpad => {
        scratchpad.focus()
        document.execCommand("Paste")
        return scratchpad.textContent
    })
    // Return focus to the document
    Messaging.messageOwnTab("commandline_content", "hide")
    Messaging.messageOwnTab("commandline_content", "blur")
    return result
}

export function getContent() {
    return clInput.value
}

export function editor_function(fn_name) {
    if (tri_editor[fn_name]) {
        tri_editor[fn_name](clInput)
    } else {
        // The user is using the command line so we can't log message there
        // logger.error(`No editor function named ${fn_name}!`)
        console.error(`No editor function named ${fn_name}!`)
    }
}

import * as SELF from "@src/commandline_frame"
Messaging.addListener("commandline_frame", Messaging.attributeCaller(SELF))

// Listen for statistics from the commandline iframe and send them to
// the background for collection. Attach the observer to the window
// object since there's apparently a bug that causes performance
// observers to be GC'd even if they're still the target of a
// callback.
;(window as any).tri = Object.assign(window.tri || {}, {
    perfObserver: perf.listenForCounters(),
})

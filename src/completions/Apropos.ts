import * as Completions from "@src/completions"
import * as Metadata from "@src/.metadata.generated"
import * as aliases from "@src/lib/aliases"
import * as config from "@src/lib/config"

class AproposCompletionOption extends Completions.CompletionOptionHTML
    implements Completions.CompletionOptionFuse {
    public fuseKeys = []

    constructor(public name: string, doc: string, flag: string) {
        super()
        this.value = `${flag} ${name}`
        this.html = html`<tr class="AproposCompletionOption option">
            <td class="name">${name}</td>
            <td class="doc">${doc}</td>
        </tr>`
    }
}

export class AproposCompletionSource extends Completions.CompletionSourceFuse {
    public options: AproposCompletionOption[]

    constructor(private _parent) {
        super(["apropos"], "AproposCompletionSource", "Apropos")

        this._parent.appendChild(this.node)
    }

    public async filter(exstr: string) {
        this.lastExstr = exstr
        this.completion = undefined
        const [prefix, query] = this.splitOnPrefix(exstr)

        // Hide self and stop if prefixes don't match
        if (prefix) {
            // Show self if prefix and currently hidden
            if (this.state === "hidden") {
                this.state = "normal"
            }
        } else {
            this.state = "hidden"
            return
        }

        const file = Metadata.everything.getFile("src/lib/config.ts")
        const default_config = file.getClass("default_config")
        const excmds = Metadata.everything.getFile("src/excmds.ts")
        const fns = excmds.getFunctions()
        const settings = config.get()
        const exaliases = settings.exaliases
        const bindings = settings.nmaps
        if (
            fns === undefined ||
            exaliases === undefined ||
            bindings === undefined
        ) {
            return
        }

        const flags = {
            "-a": (options, query) =>
                options.concat(
                    Object.keys(exaliases)
                        .filter(alias =>
                            (
                                alias +
                                aliases.expandExstr(alias) +
                                excmds.getFunction(aliases.expandExstr(alias))
                            )
                                .toLowerCase()
                                .includes(query),
                        )
                        .map(alias => {
                            const cmd = aliases.expandExstr(alias)
                            const doc =
                                (excmds.getFunction(cmd) || ({} as any)).doc ||
                                ""
                            return new AproposCompletionOption(
                                alias,
                                `Alias for \`${cmd}\`. ${doc}`,
                                "-a",
                            )
                        }),
                ),
            "-b": (options, query) =>
                options.concat(
                    Object.keys(bindings)
                        .filter(binding =>
                            (binding + bindings[binding])
                                .toLowerCase()
                                .includes(query),
                        )
                        .map(
                            binding =>
                                new AproposCompletionOption(
                                    binding,
                                    `Normal mode binding for \`${bindings[binding]}\``,
                                    "-b",
                                ),
                        ),
                ),
            "-e": (options, query) =>
                options.concat(
                    fns
                        .filter(
                            ([name, fn]) =>
                                !fn.hidden &&
                                (name + fn.doc).toLowerCase().includes(query),
                        )
                        .map(
                            ([name, fn]) =>
                                new AproposCompletionOption(
                                    name,
                                    `Excmd. ${fn.doc}`,
                                    "-e",
                                ),
                        ),
                ),
            "-s": (options, query) =>
                options.concat(
                    Object.keys(settings)
                        .filter(x =>
                            (x + default_config.getMember(x)?.doc)
                                .toLowerCase()
                                .includes(query),
                        )
                        .map(setting => {
                            const member = default_config.getMember(setting)
                            let doc = ""
                            if (member !== undefined) {
                                doc = member.doc
                            }
                            return new AproposCompletionOption(
                                setting,
                                `Setting. ${doc}`,
                                "-s",
                            )
                        }),
                ),
        }

        const args = query.split(" ")
        let opts = []
        if (Object.keys(flags).includes(args[0])) {
            opts = flags[args[0]](opts, args.slice(1).join(" "))
        } else {
            opts = Object.keys(flags).reduce(
                (acc, curFlag) => flags[curFlag](acc, query),
                [],
            )
        }

        this.options = opts
        this.options.sort((compopt1, compopt2) =>
            compopt1.name.localeCompare(compopt2.name),
        )
        return this.updateChain()
    }

    updateChain() {
        // Options are pre-trimmed to the right length.
        this.options.forEach(option => (option.state = "normal"))

        // Call concrete class
        return this.updateDisplay()
    }
}

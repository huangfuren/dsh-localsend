// dsh-localsend 浏览器设置卡片(「设置 → 插件配置」列表项)。
// 在 Host 端 settings namespace "localsend" 上注册键为 localsend 的
// settings.plugin.item 卡片:值非敏感,describe 返回明文,可回显与编辑。
window.__ModuleLoader__.load({
	id: "dsh-localsend",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const SETTINGS_NS = "localsend";
		// 与 lib/constants.js 保持一致的前端回显默认值(仅提示用,不参与 Host 校验)。
		const DEFAULTS = {
			alias: "",
			port: 53317,
			scanTimeoutMs: 1500,
			acceptTimeoutMs: 240000,
			uploadTimeoutMs: 120000,
			maxFileBytes: 1073741824,
			sharePort: 0,
			shareExpiresIn: 3600,
			sharePassword: "",
		};

		const inject = ["slots", "connection"];

		const STRINGS = {
			zh: {
				title: "LocalSend 局域网传输",
				desc: "通过 LocalSend v2 协议把文件发送到局域网内运行 LocalSend 的机器,或生成浏览器下载链接。配置仅在本地保存。",
				alias: "发送方别名(显示在接收端)",
				port: "目标端口",
				scanTimeoutMs: "设备探测超时(ms)",
				acceptTimeoutMs: "等待接收端接受(ms)",
				uploadTimeoutMs: "单文件上传超时(ms)",
				maxFileBytes: "单文件大小上限(bytes)",
				sharePort: "分享服务端口(0=随机)",
				shareExpiresIn: "分享链接有效期(秒)",
				sharePassword: "分享下载密码(空=无密码)",
				save: "保存",
				saving: "保存中…",
				saved: "已保存。新会话的工具调用将使用更新后的配置。",
				hint: "留空/使用默认值时,Host 端回退到插件内置默认(alias=主机名, port=53317, accept=240000ms)。数字需为正整数。",
				invalid: "校验失败:端口 1-65535,其余数字需为正整数。",
				error: "保存失败:"
			},
			en: {
				title: "LocalSend LAN transfer",
				desc: "Send files over LAN to machines running LocalSend (v2 protocol), or generate a browser download link. Config is stored locally only.",
				alias: "Sender alias (shown on the receiver)",
				port: "Target port",
				scanTimeoutMs: "Per-host scan timeout (ms)",
				acceptTimeoutMs: "Wait for receiver accept (ms)",
				uploadTimeoutMs: "Per-file upload timeout (ms)",
				maxFileBytes: "Per-file size limit (bytes)",
				sharePort: "Share server port (0 = random)",
				shareExpiresIn: "Share link validity (seconds)",
				sharePassword: "Share download password (empty = none)",
				save: "Save",
				saving: "Saving…",
				saved: "Saved. New tool calls will use the updated configuration.",
				hint: "Empty/default values fall back to the plugin built-ins (alias=hostname, port=53317, accept=240000ms). Numeric values must be positive integers.",
				invalid: "Validation failed: port must be 1-65535, other numbers must be positive integers.",
				error: "Save failed:"
			}
		};

		function detectLanguage() {
			try {
				if (typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("zh")) return "zh";
			} catch { /* 忽略,走默认。 */ }
			return "en";
		}

		const S = {
			card: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", background: "var(--dsw-alias-bg-layer-3)", marginBottom: "12px" },
			cardOpen: { background: "var(--dsw-alias-bg-layer-2)" },
			header: { display: "flex", alignItems: "center", gap: "12px", width: "100%", padding: "16px", margin: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" },
			headerText: { display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 auto", minWidth: 0 },
			chevron: { flexShrink: 0, display: "inline-flex", transition: "transform .16s", color: "var(--dsw-alias-label-tertiary)" },
			body: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", padding: "16px 0", display: "flex", flexDirection: "column", gap: "12px" },
			title: { margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
			desc: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-secondary)" },
			row: { display: "flex", flexDirection: "column", gap: "6px" },
			label: { fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
			input: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", flex: "1 1 auto", minWidth: 0 },
			hint: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
			footer: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
			button: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", height: "32px", padding: "0 14px", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
			msg: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
			err: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-error)" }
		};

		const h = react.createElement;
		const FIELDS = ["alias", "port", "scanTimeoutMs", "acceptTimeoutMs", "uploadTimeoutMs", "maxFileBytes", "sharePort", "shareExpiresIn", "sharePassword"];

		function LocalsendCard(props) {
			const face = props.localsendCard;
			const [open, setOpen] = react.useState(false);
			const [saving, setSaving] = react.useState(false);
			const [saved, setSaved] = react.useState(false);
			const [error, setError] = react.useState("");
			const [lang, setLang] = react.useState(detectLanguage);
			const [draft, setDraft] = react.useState(Object.assign({}, DEFAULTS));
			const T = STRINGS[lang] ?? STRINGS.en;

			react.useEffect(() => {
				let alive = true;
				face.readValues().then((vals) => {
					if (!alive) return;
					setDraft(Object.assign({}, DEFAULTS, vals));
				}).catch(() => {});
				face.localePreference().then((p) => {
					if (alive && (p === "zh" || p === "en")) setLang(p);
				}).catch(() => {});
				return () => { alive = false; };
			}, [face]);

			function setField(key, value) {
				setSaved(false);
				setError("");
				setDraft((d) => Object.assign({}, d, { [key]: value }));
			}

			async function onSave() {
				setSaving(true); setSaved(false); setError("");
				try {
					const patch = {};
					for (const k of FIELDS) {
						let v = draft[k];
						if (typeof v === "string") v = v.trim();
						if (k === "alias" || k === "sharePassword") {
							if (v !== "") patch[k] = v;
							continue;
						}
						if (v === "") continue; // 空 = 使用默认
						const n = Number(v);
						if (!Number.isInteger(n) || n <= 0 || (k === "port" && (n < 1 || n > 65535))) {
							throw new Error(T.invalid);
						}
						patch[k] = n;
					}
					await face.saveValues(patch);
					const vals = await face.readValues();
					setDraft(Object.assign({}, DEFAULTS, vals));
					setSaved(true);
				} catch (e) {
					setError(String(e?.message ?? e));
				} finally {
					setSaving(false);
				}
			}

			const inputRows = FIELDS.map((k) =>
				h("div", { key: k, style: S.row }, [
					h("label", { style: S.label }, T[k] || k),
					h("input", {
						type: (k === "alias" || k === "sharePassword") ? "text" : "number",
						style: S.input,
						placeholder: k === "alias" ? "(hostname)" : String(DEFAULTS[k]),
						value: draft[k] === "" ? "" : String(draft[k]),
						onChange: (e) => setField(k, e.target.value),
					}),
				])
			);

			return h("section", { style: open ? { ...S.card, ...S.cardOpen } : S.card }, [
				h("button", {
					type: "button", style: S.header, "aria-expanded": open,
					onClick: () => setOpen(!open),
				}, [
					h("span", { style: S.headerText }, [
						h("span", { style: S.title }, T.title),
						h("span", { style: S.desc }, T.desc),
					]),
					h("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", style: { ...S.chevron, transform: open ? "rotate(180deg)" : "none" } },
						h("path", { d: "M3.5 5.25 7 8.75 10.5 5.25", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })),
				]),
				open ? h("div", { style: S.body }, [
					...inputRows,
					h("p", { style: S.hint }, T.hint),
					h("div", { style: S.footer }, [
						h("button", { style: S.button, disabled: saving, onClick: onSave }, saving ? T.saving : T.save),
						saved ? h("p", { style: S.msg }, T.saved) : null,
						error ? h("p", { style: S.err }, T.error + " " + error) : null,
					]),
				]) : null,
			]);
		}

		function apply(ctx) {
			const { api } = ctx.get("connection");
			const face = {
				readValues: async () => {
					if (!api.settings?.describe) return {};
					const res = await api.settings.describe({});
					const namespaces = res?.result?.value?.namespaces ?? [];
					const ns = namespaces.find((n) => n?.ns === SETTINGS_NS);
					const value = ns && typeof ns.value === "object" ? ns.value : {};
					const out = {};
					for (const k of FIELDS) if (typeof value[k] !== "undefined") out[k] = value[k];
					return out;
				},
				// update 做 deep-merge:只改传入字段。
				saveValues: (patch) => api.settings.update({ ns: SETTINGS_NS, patch }),
				localePreference: async () => {
					if (!api.settings?.describe) return "";
					const res = await api.settings.describe({});
					const namespaces = res?.result?.value?.namespaces ?? [];
					const locale = namespaces.find((n) => n?.ns === "locale");
					const pref = locale?.value?.preference;
					return typeof pref === "string" ? pref : "";
				},
			};
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				// keyed slot:配置页按 Host 端 settings namespace 派发卡片,key 必须与
				// index.js 的 SETTINGS_NAMESPACE('localsend') 一致,否则不会渲染。
				name: "settings.plugin.item",
				key: SETTINGS_NS,
				inject: () => ({ localsendCard: face }),
			}, LocalsendCard));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

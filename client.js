// dsh-localsend 浏览器设置卡片(「设置 → 插件配置」列表项)。
// 在 Host 端 settings namespace "localsend"（entryId）上取共享表单，挂进
// 「设置 → 内置插件」页签：值非敏感，describe 返回明文，可回显与编辑。
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

		// dsh 0.2.0：settingsScope 已删除。设置读写走 ctx.configForms（宿主 settings 域
		// 提供的共享表单），卡片挂进设置面板的 "settings.plugins.tab" 页签。
		// entryId 必须与 index.js 的 SETTINGS_NAMESPACE 一致 —— 宿主分配的实例 id。
		const inject = ["slots", "configForms"];

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
				// 语言偏好是可选能力：旧版 face 没有这个方法，直接调用会让 useEffect 抛
				// TypeError 并连带整张卡片崩溃（表现为「内置插件」页签里一片空白）。
				// 这里先探测再调用，缺它只损失语言切换，不影响配置编辑。
				if (typeof face.localePreference === "function") {
					try {
						face.localePreference().then((p) => {
							if (alive && (p === "zh" || p === "en")) setLang(p);
						}).catch(() => {});
					} catch { /* 忽略：语言探测失败不影响卡片。 */ }
				}
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

		// dsh 0.2.0 设置卡片。宿主把 Config schema 自动投影成表单，页面挂在设置面板的
		// 「内置插件」页签里；只要 Host 还在服务 localsend 这个命名空间，页面就注册，
		// 否则部署里看不到这个插件的任何痕迹。
		function apply(ctx) {
			// 兼容性加固：apply 抛异常会让本插件在客户端侧加载失败。旧写法
			// ctx.get("connection") 解构在服务缺失时会直接抛 TypeError。
			try {
				if (typeof ctx.configForms?.get !== 'function') {
					console.warn('[localsend] configForms unavailable; settings card not registered');
					return;
				}
				if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') {
					console.warn('[localsend] slots API changed; settings card not registered');
					return;
				}
				const form = ctx.configForms.get(SETTINGS_NS);

				// 值域：取 form 快照。快照里的 value 已是宿主解析过的普通值，
				// 不是 Volatile 包装 —— 包装只存在于 Host 进程内的 Config 递交。
				const face = {
					readValues: async () => {
						try {
							const v = form.getSnapshot()?.value;
							const out = {};
							if (v && typeof v === 'object') {
								for (const k of FIELDS) if (typeof v[k] !== 'undefined') out[k] = v[k];
							}
							return out;
						} catch {
							return {};
						}
					},
					// 逐字段 set 即「设置该字段」，与旧 update 的 deep-merge patch 语义等价。
					saveValues: async (patch) => {
						for (const k of Object.keys(patch)) await form.set(k, patch[k]);
					},
					// 卡片文案语言：宿主暴露 locale 偏好时用它，否则退回浏览器语言。
					// 始终返回 Promise —— 调用方按 thenable 使用。
					localePreference: async () => {
						try {
							const snapshot = typeof ctx.locale?.getSnapshot === 'function' ? ctx.locale.getSnapshot() : undefined;
							const pref = snapshot && (snapshot.preference ?? snapshot.language);
							if (pref === 'zh' || pref === 'en') return pref;
						} catch { /* locale 服务缺失或不兼容，退回浏览器语言。 */ }
						return detectLanguage();
					},
				};

				// 只有 Host 服务该命名空间时才挂页面；未部署 Host 侧插件时页面不出现。
				const mount = () => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
					name: 'settings.plugins.tab',
					id: SETTINGS_NS,
					order: 45,
					label: () => (STRINGS[detectLanguage()] ?? STRINGS.en).title,
					inject: () => ({ localsendCard: face }),
				}, LocalsendCard));
				ctx.effect(() => {
					if (typeof ctx.configForms.whileServed !== 'function') return mount();
					return ctx.configForms.whileServed([SETTINGS_NS], mount);
				}, 'localsend: settings tab');
			} catch (err) {
				console.warn('[localsend] settings card registration failed: ' + (err && err.message ? err.message : err));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

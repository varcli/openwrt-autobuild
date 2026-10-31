'use strict';
'require view';
'require rpc';
'require uci';
'require ui';
'require home.setup as setup';

var getDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices' });
var configs = ['network', 'dhcp', 'firewall', 'home'];

function snapshot() {
	var result = {};
	configs.forEach(function(config) { result[config] = JSON.parse(JSON.stringify(uci.sections(config))); });
	return result;
}
function input(id, value, type) {
	return E('input', { id: 'home-setup-' + id, 'class': 'cbi-input-text', type: type || 'text', value: value || '', maxlength: type === 'password' ? 256 : 512, autocomplete: type === 'password' ? 'new-password' : 'off' });
}
function row(title, field, help) {
	return E('div', { 'class': 'ows-row' }, [E('label', { 'for': field.id }, title), E('div', {}, [field, help ? E('p', { 'class': 'ows-help' }, help) : null])]);
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
	load: function() {
		return Promise.all([getDevices()].concat(configs.map(function(config) { return uci.load(config); })));
	},
	collect: function() {
		var values = { mode: this.mode.value, lanPorts: this.portChecks.filter(function(item) { return item.input.checked; }).map(function(item) { return item.name; }), wanPort: this.wanPort.value, protocol: this.protocol.value };
		Object.keys(this.fields).forEach(function(key) { values[key] = key === 'password' ? this.fields[key].value : this.fields[key].value.trim(); }, this);
		return values;
	},
	showStep: function(step) {
		this.step = step;
		this.panels.forEach(function(panel, index) { panel.hidden = index !== step; });
		this.stepLabels.forEach(function(label, index) { label.className = index === step ? 'is-current' : ''; });
		this.back.hidden = step === 0;
		this.next.hidden = step === 2;
		this.apply.hidden = step !== 2;
		this.error.hidden = true;
	},
	refreshFields: function() {
		var side = this.mode.value === 'side', protocol = this.protocol.value;
		this.sideFields.hidden = !side;
		this.wanFields.hidden = side;
		this.staticFields.hidden = side || protocol !== 'static';
		this.pppFields.hidden = side || protocol !== 'pppoe';
	},
	review: function() {
		var result = setup.plan(this.collect(), this.original, this.ports), value = result.value;
		this.summary.replaceChildren();
		var rows = [
			['运行模式', value.mode === 'side' ? '旁路由' : '主路由'], ['LAN 网口', value.lanPorts.join('、')],
			['管理地址', value.lanIP + ' / ' + value.lanMask], ['LAN DHCP', value.mode === 'side' ? '关闭，地址由主路由分配' : '开启'],
			['IPv6 通告', value.mode === 'side' ? '关闭 LAN 的 DHCPv6、RA 和 NDP' : 'WAN6 自动获取，LAN 提供 DHCPv6 和 RA']
		];
		if (value.mode === 'side') rows.push(['默认网关', value.gateway], ['DNS', value.dns.join('、')], ['WAN', '关闭']);
		else rows.push(['WAN 网口', value.wanPort], ['上网方式', {dhcp:'自动获取地址',pppoe:'PPPoE 拨号',static:'静态地址'}[value.protocol]]);
		if (value.mode === 'router' && value.protocol === 'static') rows.push(['WAN 地址', value.wanIP + ' / ' + value.wanMask], ['WAN 网关', value.wanGateway], ['WAN DNS', value.wanDNS.join('、')]);
		rows.forEach(function(item) { this.summary.appendChild(E('div', { 'class': 'ows-summary-row' }, [E('dt', {}, item[0]), E('dd', {}, item[1])])); }, this);
		this.newAddress.textContent = window.location.protocol + '//' + value.lanIP + (window.location.port ? ':' + window.location.port : '') + L.url('admin/home');
		this.newAddress.href = this.newAddress.textContent;
		return result;
	},
	nextStep: function() {
		try {
			if (this.step === 0) {
				if (this.mode.value === 'router' && this.ports.length < 2) throw new Error('主路由需要独立的 LAN 和 WAN 接口。单网口请使用旁路由；VLAN 或无线中继请进入高级网络设置。');
				this.refreshFields();
				this.showStep(1);
			}
			else { this.review(); this.showStep(2); }
		} catch (error) { this.showError(error); }
	},
	showError: function(error) { this.error.textContent = error.message || String(error); this.error.hidden = false; },
	applySettings: function() {
		var self = this, result;
		if (!L.hasViewPermission()) return;
		try { result = this.review(); } catch (error) { this.showError(error); return; }
		this.apply.disabled = true;
		this.back.disabled = true;
		return uci.changes().then(function(changes) {
			if (Object.keys(changes || {}).some(function(key) { return changes[key].length; })) throw new Error('当前会话已有未应用的配置，请先通过 LuCI 顶部的“未保存的配置”处理，再重新打开向导。');
			setup.stage(result);
			return uci.save();
		}).then(function() {
			// 使用 LuCI 原生的带确认应用、连接检查和超时回滚，不直接 commit 或重启网络。
			ui.changes.apply(true);
		}).catch(function(error) {
			self.showError(new Error((error.message || String(error)) + '；网络尚未通过向导应用，请检查未保存的配置。'));
		}).finally(function() { self.apply.disabled = false; self.back.disabled = false; });
	},
	render: function(data) {
		var self = this, writable = L.hasViewPermission();
		this.original = snapshot();
		this.ports = setup.portNames(data[0]);
		var defaults = setup.defaults(this.original, this.ports);
		this.fields = {};
		this.portChecks = [];
		this.mode = E('select', { id: 'home-setup-mode', 'class': 'cbi-input-select', disabled: writable ? null : true, change: function() {
			if (self.mode.value === 'router' && self.fields.lanIP.value === '192.168.123.2') self.fields.lanIP.value = '192.168.100.1';
			if (self.mode.value === 'side' && self.fields.lanIP.value === '192.168.100.1') self.fields.lanIP.value = '192.168.123.2';
			if (self.mode.value === 'router') self.portChecks.forEach(function(item) { if (item.name === self.wanPort.value) item.input.checked = false; });
			self.refreshFields();
		} }, [E('option', { value: 'side' }, '旁路由'), E('option', { value: 'router' }, '主路由')]);
		this.mode.value = defaults.mode;
		var portChoices = E('div', { 'class': 'ows-port-list' });
		this.ports.forEach(function(name) {
			var check = E('input', { type: 'checkbox', value: name, checked: defaults.lanPorts.indexOf(name) >= 0 ? true : null, disabled: writable ? null : true });
			self.portChecks.push({ name: name, input: check });
			portChoices.appendChild(E('label', {}, [check, ' ' + name + (data[0][name].macaddr ? ' · ' + data[0][name].macaddr : '')]));
		});
		this.wanPort = E('select', { id: 'home-setup-wan', 'class': 'cbi-input-select', disabled: writable ? null : true, change: function() {
			self.portChecks.forEach(function(item) { if (item.name === self.wanPort.value) item.input.checked = false; });
		} }, this.ports.map(function(name) { return E('option', { value: name }, name); }));
		this.wanPort.value = defaults.wanPort;
		this.protocol = E('select', { id: 'home-setup-protocol', 'class': 'cbi-input-select', disabled: writable ? null : true, change: function() { self.refreshFields(); } }, [
			E('option', { value: 'dhcp' }, '自动获取地址（DHCP）'), E('option', { value: 'pppoe' }, 'PPPoE 拨号'), E('option', { value: 'static' }, '静态地址')
		]);
		this.protocol.value = defaults.protocol;
		['lanIP', 'lanMask', 'gateway', 'dns', 'wanIP', 'wanMask', 'wanGateway', 'wanDNS', 'username', 'password'].forEach(function(key) {
			self.fields[key] = input(key, defaults[key], key === 'password' ? 'password' : 'text');
			self.fields[key].disabled = !writable;
		});
		this.sideFields = E('div', {}, [row('主路由地址', this.fields.gateway), row('DNS 服务器', this.fields.dns, '填写 IPv4 地址，多个地址用空格分隔。')]);
		this.staticFields = E('div', {}, [row('WAN 地址', this.fields.wanIP), row('WAN 子网掩码', this.fields.wanMask), row('WAN 网关', this.fields.wanGateway), row('WAN DNS', this.fields.wanDNS, '填写 IPv4 地址，多个地址用空格分隔。')]);
		this.pppFields = E('div', {}, [row('宽带账号', this.fields.username), row('宽带密码', this.fields.password)]);
		this.wanFields = E('div', {}, [row('WAN 网口', this.wanPort), row('上网方式', this.protocol), this.staticFields, this.pppFields]);
		this.summary = E('dl', { 'class': 'ows-summary' });
		this.newAddress = E('a', { target: '_blank', rel: 'noopener noreferrer' });
		this.panels = [
			E('section', {}, [
				row('运行模式', this.mode),
				E('p', { 'class': 'ows-help' }, '旁路由：主路由分配地址，客户端手动将网关指向本机。主路由：本机提供 DHCP、NAT 和上网连接。'),
				E('p', { 'class': 'ows-help' }, '向导用于基础以太网配置。单网口默认推荐旁路由；VLAN、无线中继和复杂网桥请使用网络接口页面。')
			]),
			E('section', {}, [row('LAN 网口', portChoices), row('管理地址', this.fields.lanIP), row('子网掩码', this.fields.lanMask), this.sideFields, this.wanFields]),
			E('section', {}, [
				this.summary,
				E('p', { 'class': 'ows-help' }, '应用会更新 LAN/WAN、DHCP 与对应防火墙区域。主路由的 WAN 入站将设为拒绝，并启用 LAN 到 WAN 的转发和 NAT。'),
				E('p', {}, ['应用后管理地址：', this.newAddress]),
				E('p', { 'class': 'ows-help' }, '接好网线后再应用。如果管理地址或网段变化，请将电脑切换到新网段并连接新地址，按 LuCI 提示完成确认；超时未确认会回滚。')
			])
		];
		this.error = E('p', { 'class': 'alert-message error', role: 'alert' });
		this.back = E('button', { 'class': 'btn', click: function() { self.showStep(self.step - 1); } }, '上一步');
		this.next = E('button', { 'class': 'btn cbi-button-action', click: function() { self.nextStep(); } }, '下一步');
		this.apply = E('button', { 'class': 'btn cbi-button-positive', disabled: writable ? null : true, click: function() { return self.applySettings(); } }, '确认并应用');
		this.stepLabels = ['1. 选择模式', '2. 网络设置', '3. 确认配置'].map(function(label) { return E('li', {}, label); });
		var page = E('div', { 'class': 'owh-setup' }, [
			E('link', { rel: 'stylesheet', href: L.resource('home/home.css') }),
			E('h2', {}, '网络配置向导'),
			E('ol', { 'class': 'ows-steps' }, this.stepLabels), this.error,
			E('p', { 'class': 'alert-message warning', hidden: this.ports.length ? true : null }, '未发现可用以太网口，请到网络接口页面检查设备。'),
			this.panels[0], this.panels[1], this.panels[2],
			E('div', { 'class': 'ows-actions' }, [this.back, ' ', this.next, ' ', this.apply]),
			E('div', { 'class': 'ows-links' }, [
				E('button', { 'class': 'btn', click: function() {
					try { window.sessionStorage.setItem('home-setup-skipped', '1'); } catch (e) {}
					window.location.href = L.url('admin/home');
				} }, '保留当前配置，进入主页'),
				E('a', { href: L.url('admin/network/network') }, '高级网络设置'),
				E('a', { href: L.url('admin/system/flash') }, '备份配置')
			])
		]);
		this.showStep(0);
		this.refreshFields();
		return page;
	}
});

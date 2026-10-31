'use strict';
'require view';
'require rpc';
'require fs';
'require uci';
'require request';
'require poll';

var getBoard = rpc.declare({ object: 'system', method: 'board' });
var getInfo = rpc.declare({ object: 'system', method: 'info' });
var getInterfaces = rpc.declare({ object: 'network.interface', method: 'dump' });
var getDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices' });
var getMounts = rpc.declare({ object: 'luci', method: 'getMountPoints' });
var getServices = rpc.declare({ object: 'service', method: 'list' });

function number(value) { return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null; }
function bytes(value) {
	if (number(value) == null) return '—';
	var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], unit = 0;
	while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
	return value.toFixed(unit && value < 100 ? 1 : 0) + ' ' + units[unit];
}
function uptime(value) {
	if (number(value) == null) return '—';
	var days = Math.floor(value / 86400), hours = Math.floor(value % 86400 / 3600), minutes = Math.floor(value % 3600 / 60);
	return (days ? days + ' 天 ' : '') + hours + ' 小时 ' + minutes + ' 分钟';
}
function cpuSample(text) {
	var match = /^cpu[ \t]+([\d \t]+)$/m.exec(text || '');
	if (!match) return null;
	var ticks = match[1].trim().split(/\s+/).slice(0, 8).map(Number);
	if (ticks.length < 4 || ticks.some(function(t) { return !isFinite(t); })) return null;
	return { total: ticks.reduce(function(a, b) { return a + b; }, 0), idle: ticks[3] + (ticks[4] || 0) };
}
function cpuUsage(before, after) {
	if (!before || !after || after.total <= before.total || after.idle < before.idle) return null;
	return Math.max(0, Math.min(100, 100 * (1 - (after.idle - before.idle) / (after.total - before.total))));
}
function menuEntries(tree) {
	var result = [];
	function walk(node, path) {
		if (!node || typeof node !== 'object' || node.satisfied === false) return;
		if (node.action && node.title && path[0] === 'admin') result.push({ path: path, title: node.title });
		Object.keys(node.children || {}).forEach(function(key) { walk(node.children[key], path.concat(key)); });
	}
	if (tree && tree.children) walk(tree, []);
	else if (tree && tree.admin) walk(tree.admin, ['admin']);
	return result;
}
function findEntry(entries, names) {
	return entries.find(function(entry) {
		return names.some(function(name) {
			return entry.path.indexOf(name) >= 0 || String(entry.title).toLowerCase().indexOf(name) >= 0;
		});
	});
}
function networkState(interfaces, config) {
	var lan = interfaces.find(function(iface) { return iface.interface === 'lan'; }) || {};
	var wan = interfaces.find(function(iface) { return iface.interface === 'wan'; });
	var routes = lan.route || [], gateway = (routes.find(function(route) { return route.target === '0.0.0.0' && Number(route.mask) === 0; }) || {}).nexthop;
	var lanConfig = config.lan || {}, dhcp = config.dhcp || {};
	var ignored = dhcp.ignore === '1', mode = '自定义网络';
	if (lanConfig.proto === 'static' && ignored && (gateway || lanConfig.gateway)) mode = '旁路由';
	else if (wan && !ignored && wan.proto && wan.proto !== 'none') mode = '主路由';
	var upstream = interfaces.find(function(iface) {
		return iface.up && (iface.route || []).some(function(route) { return route.target === '0.0.0.0' && Number(route.mask) === 0; });
	});
	var route = ((upstream || {}).route || []).find(function(item) { return item.target === '0.0.0.0' && Number(item.mask) === 0; });
	var address = (lan['ipv4-address'] || [])[0];
	return {
		lan: lan, mode: mode, dhcp: Object.keys(dhcp).length ? (ignored ? '已关闭' : '已启用') : '未知',
		address: address ? address.address + '/' + address.mask : (lanConfig.ipaddr || '未分配 IPv4'),
		gateway: route && route.nexthop || gateway || lanConfig.gateway || '未配置',
		gatewayActive: !!route, dns: (upstream || lan)['dns-server'] || [],
		device: lan.l3_device || lan.device || lanConfig.device || ''
	};
}
function mountState(mounts) {
	var list = Array.isArray(mounts) ? mounts : mounts && mounts.result || [];
	return list.find(function(mount) { return mount.mount === '/overlay'; }) ||
		list.find(function(mount) { return mount.mount === '/'; }) || null;
}
function serviceState(services, names) {
	var states = [];
	names.forEach(function(name) {
		var service = services && services[name];
		Object.keys(service && service.instances || {}).forEach(function(key) {
			var running = service.instances[key].running;
			if (typeof running === 'boolean') states.push(running);
		});
	});
	if (states.some(function(running) { return running === true; })) return '运行中';
	return states.length ? '未运行' : '已安装';
}
function textNode(tag, className, text) { return E(tag, { 'class': className }, text); }
function heading(title) {
	return E('div', { 'class': 'owh-section-title' }, textNode('h3', '', title));
}
function keyValue(label, value, mono) {
	return E('div', { 'class': 'owh-detail' }, [textNode('dt', '', label), textNode('dd', mono ? 'owh-mono' : '', value == null ? '—' : String(value))]);
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	readLive: function() {
		var errors = [];
		function read(label, promise, fallback) {
			return promise.catch(function() { errors.push(label); return fallback; });
		}
		return Promise.all([
			read('系统信息', getInfo(), null), read('网络接口', getInterfaces(), null),
			read('网卡统计', getDevices(), null), read('磁盘空间', getMounts(), null),
			read('服务状态', getServices(), null), read('CPU 统计', fs.read('/proc/stat'), '')
		]).then(function(data) { return { info: data[0], interfaces: data[1], devices: data[2], mounts: data[3], services: data[4], cpu: cpuSample(data[5]), errors: errors }; });
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(getBoard(), {}),
			L.resolveDefault(request.get(L.url('admin/menu')).then(function(response) { return response.json(); }), null),
			L.resolveDefault(fs.read('/usr/share/online-upgrade/build.json').then(JSON.parse), {}),
			L.resolveDefault(uci.load('network'), null), L.resolveDefault(uci.load('dhcp'), null),
			this.readLive(),
			L.resolveDefault(uci.load('home').then(function() { return uci.get('home', 'main', 'completed') !== '1'; }), false)
		]);
	},

	updateLive: function(data) {
		var info = data.info || {}, interfaces = data.interfaces && data.interfaces.interface || [], devices = data.devices || {};
		var state = networkState(interfaces, this.config), now = Date.now(), currentCpu = cpuUsage(this.lastCpu, data.cpu);
		this.lastCpu = data.cpu;
		this.mode.textContent = state.mode;
		this.address.textContent = state.address;
		this.gateway.textContent = state.gateway;
		this.routeStatus.textContent = state.gatewayActive ? '默认路由已就绪' : '未检测到 IPv4 默认路由';
		this.routeStatus.className = 'owh-route-status' + (state.gatewayActive ? ' is-ready' : '');
		this.connection.textContent = data.interfaces == null ? '状态未知' : (state.lan.up ? 'LAN 已连接' : 'LAN 未连接');
		this.connection.className = 'owh-connection label' + (state.lan.up ? ' success' : '');
		this.dhcp.textContent = state.dhcp;
		this.dns.textContent = state.dns.length ? state.dns.join(' · ') : '未获取';
		this.elapsed.textContent = uptime(info.uptime);
		this.deviceName.textContent = state.device || '未获取';
		this.cpu.value.textContent = currentCpu == null ? (data.cpu ? '采样中' : '—') : currentCpu.toFixed(0) + '%';
		this.cpu.bar.style.width = (currentCpu == null ? 0 : currentCpu) + '%';
		var load = Array.isArray(info.load) ? (info.load[0] / 65535).toFixed(2) : '—';
		this.cpu.note.textContent = '1 分钟负载 ' + load;
		var memory = info.memory || {}, total = number(memory.total), available = number(memory.available);
		if (available == null && total != null && number(memory.free) != null) available = memory.free + (number(memory.buffered) || 0) + (number(memory.cached) || 0);
		var used = total && available != null ? Math.max(0, Math.min(total, total - available)) : null;
		this.memory.value.textContent = used == null ? '—' : (used / total * 100).toFixed(0) + '%';
		this.memory.bar.style.width = (used == null ? 0 : used / total * 100) + '%';
		this.memory.note.textContent = used == null ? '内存信息不可用' : bytes(used) + ' / ' + bytes(total);
		var disk = mountState(data.mounts), diskSize = disk && number(disk.size), free = disk && number(disk.avail);
		var diskUsed = diskSize > 0 && number(disk.free) != null ? Math.max(0, diskSize - disk.free) : null;
		this.disk.value.textContent = free == null ? '—' : bytes(free);
		this.disk.note.textContent = diskSize ? '总容量 ' + bytes(diskSize) : '磁盘信息不可用';
		this.disk.bar.style.width = (diskUsed == null ? 0 : Math.min(100, diskUsed / diskSize * 100)) + '%';
		this.disk.root.classList.toggle('is-low', free != null && free < 96 * 1024 * 1024);
		var counters = devices[state.device] && (devices[state.device].stats || devices[state.device].statistics);
		var rx = null, tx = null, before = this.lastTraffic;
		if (counters && before && before.device === state.device && now > before.time) {
			var seconds = (now - before.time) / 1000;
			if (number(counters.rx_bytes) != null && counters.rx_bytes >= before.rx) rx = (counters.rx_bytes - before.rx) / seconds;
			if (number(counters.tx_bytes) != null && counters.tx_bytes >= before.tx) tx = (counters.tx_bytes - before.tx) / seconds;
		}
		this.lastTraffic = counters && number(counters.rx_bytes) != null && number(counters.tx_bytes) != null ? { device: state.device, rx: counters.rx_bytes, tx: counters.tx_bytes, time: now } : null;
		this.rx.textContent = rx == null ? '—' : bytes(rx) + '/s';
		this.tx.textContent = tx == null ? '—' : bytes(tx) + '/s';
		this.history.push({ rx: rx, tx: tx });
		if (this.history.length > 30) this.history.shift();
		var max = Math.max.apply(null, [1024].concat(this.history.map(function(point) { return Math.max(point.rx || 0, point.tx || 0); })));
		this.chart.replaceChildren();
		this.history.forEach(function(point) {
			this.chart.appendChild(E('div', { 'class': 'owh-sample' }, [
				E('i', { 'class': 'owh-rx-bar', style: 'height:' + (!point.rx ? 0 : Math.max(2, point.rx / max * 100)) + '%' }),
				E('i', { 'class': 'owh-tx-bar', style: 'height:' + (!point.tx ? 0 : Math.max(2, point.tx / max * 100)) + '%' })
			]));
		}, this);
		this.interfaceList.replaceChildren();
		var visible = interfaces.filter(function(iface) { return iface.interface !== 'loopback'; });
		if (!visible.length) this.interfaceList.appendChild(textNode('p', 'owh-empty', '暂未获取到网络接口。'));
		visible.forEach(function(iface) {
			var addresses = (iface['ipv4-address'] || []).map(function(address) { return address.address + '/' + address.mask; });
			this.interfaceList.appendChild(E('div', { 'class': 'owh-interface' }, [
				E('div', {}, [textNode('strong', 'owh-mono', iface.interface), textNode('small', '', iface.l3_device || iface.device || iface.proto || '—')]),
				textNode('span', 'owh-mono owh-interface-address', addresses.join(' · ') || ((iface['ipv6-address'] || [])[0] || {}).address || '未分配地址'),
				textNode('span', 'owh-state' + (iface.up ? ' is-running' : ''), iface.up ? '已连接' : (iface.pending ? '连接中' : '未连接'))
			]));
		}, this);
		this.apps.forEach(function(app) {
			var status = data.services == null ? '状态未知' : serviceState(data.services, app.services);
			app.status.textContent = app.services.length ? status : '打开';
			app.status.className = 'owh-app-status' + (status === '运行中' && app.services.length ? ' is-running' : '');
		});
		this.updated.textContent = '每 5 秒刷新';
		this.error.textContent = data.errors.length ? '部分信息暂不可用：' + data.errors.join('、') + '。请检查权限或稍后刷新。' : '';
		this.error.hidden = !data.errors.length;
	},

	refresh: function() {
		var self = this;
		return self.readLive().then(function(data) { self.updateLive(data); });
	},

	render: function(data) {
		var skipped = false;
		try { skipped = window.sessionStorage.getItem('home-setup-skipped') === '1'; } catch (e) {}
		if (data[6] === true && !skipped && L.hasViewPermission()) {
			window.location.replace(L.url('admin/system/home-setup'));
			return E('p', { 'class': 'spinning' }, '正在打开首次网络配置向导…');
		}
		var self = this, board = data[0], entries = menuEntries(data[1]), build = data[2];
		this.config = { lan: uci.get('network', 'lan') || {}, dhcp: uci.get('dhcp', 'lan') || {} };
		this.history = [];
		this.lastCpu = null;
		this.lastTraffic = null;
		this.apps = [];
		this.mode = textNode('span', 'owh-mode label', '读取网络配置');
		this.connection = textNode('span', 'owh-connection label', '正在获取状态');
		this.updated = textNode('span', 'owh-updated', '正在获取状态');
		this.error = textNode('p', 'owh-error alert-message warning', '');
		this.error.hidden = true;
		this.address = textNode('strong', 'owh-mono', '—');
		this.gateway = textNode('strong', 'owh-mono', '—');
		this.routeStatus = textNode('span', 'owh-route-status', '读取路由');
		this.dhcp = textNode('span', '', '—');
		this.dns = textNode('span', 'owh-mono', '—');
		this.elapsed = textNode('span', 'owh-mono', '—');
		this.deviceName = textNode('span', 'owh-mono', '—');
		this.rx = textNode('strong', 'owh-mono', '—');
		this.tx = textNode('strong', 'owh-mono', '—');
		this.chart = E('div', { 'class': 'owh-chart', 'aria-label': '最近 30 次采样的 LAN 接收与发送速率' });
		this.interfaceList = E('div', { 'class': 'owh-interfaces' });
		function meter(label, initial) {
			var value = textNode('strong', 'owh-metric-value owh-mono', initial), note = textNode('span', 'owh-metric-note', '采样中');
			var bar = E('i', { style: 'width:0%' });
			var root = E('div', { 'class': 'owh-meter' }, [E('div', { 'class': 'owh-meter-head' }, [textNode('span', '', label), value]), E('div', { 'class': 'owh-track' }, bar), note]);
			return { value: value, note: note, bar: bar, root: root };
		}
		this.cpu = meter('CPU 使用率', '采样中');
		this.memory = meter('内存使用率', '—');
		this.disk = meter('根分区可用空间', '—');
		var apps = E('div', { 'class': 'owh-apps' });
		[
			{ names: ['passwall'], title: 'Passwall', services: ['passwall'] },
			{ names: ['openclash'], title: 'OpenClash', services: ['openclash'] },
			{ names: ['clashoo'], title: 'Clashoo', services: ['clashoo', 'mihomo'] },
			{ names: ['dockerman', 'docker'], title: 'Docker', services: ['dockerd'] },
			{ names: ['online-upgrade'], title: '固件更新', services: [] },
			{ names: ['amlogic'], title: '晶晨宝盒', services: [] },
			{ names: ['bandix'], title: 'Bandix', services: ['bandix'] },
			{ names: ['filemanager', 'quickfile'], title: '文件管理', services: [] },
			{ names: ['ttyd'], title: '终端', services: ['ttyd'] }
		].forEach(function(app) {
			var entry = findEntry(entries, app.names);
			if (!entry) return;
			app.status = textNode('span', 'owh-app-status', '打开');
			self.apps.push(app);
			apps.appendChild(E('a', { 'class': 'owh-app', href: L.url.apply(L, entry.path) }, [
				textNode('strong', 'owh-app-label', app.title), app.status
			]));
		});
		if (!self.apps.length) apps.appendChild(textNode('p', 'owh-empty', data[1] == null ? '应用菜单暂不可用，请刷新页面重试。' : '安装应用后，可从这里快速进入。'));
		var shortcuts = E('nav', { 'class': 'owh-shortcuts', 'aria-label': '系统快捷入口' });
		[
			{ path: ['admin', 'system', 'home-setup'], title: '网络向导' },
			{ path: ['admin', 'network', 'network'], title: '网络接口' },
			{ path: ['admin', 'network', 'dhcp'], title: 'DHCP' },
			{ path: ['admin', 'network', 'firewall'], title: '防火墙' },
			{ path: ['admin', 'system', 'flash'], title: '备份与更新' },
			{ path: ['admin', 'status', 'overview'], title: '详细状态' }
		].forEach(function(link) {
			if (entries.some(function(entry) { return entry.path.join('/') === link.path.join('/'); })) shortcuts.appendChild(E('a', { href: L.url.apply(L, link.path) }, link.title + ' ↗'));
		});
		var release = board.release || {}, firmware = release.distribution || 'OpenWrt';
		var style = E('link', { rel: 'stylesheet', type: 'text/css', href: L.resource('home/home.css') });
		var page = E('div', { 'class': 'owh-home' }, [
			style,
			E('div', { 'class': 'owh-header' }, [
				E('div', {}, [E('div', { 'class': 'owh-identity' }, [textNode('strong', 'owh-hostname', board.hostname || '设备'), this.mode]), textNode('p', 'owh-subtitle', board.model || board.system || '设备信息暂不可用')]),
				E('div', { 'class': 'owh-header-status' }, [this.connection, this.updated])
			]),
			this.error,
			E('div', { 'class': 'owh-top-grid' }, [
				E('section', { 'class': 'cbi-section owh-panel owh-network' }, [
					heading('网络状态'),
					E('div', { 'class': 'owh-topology' }, [
						E('div', { 'class': 'owh-endpoint' }, [textNode('span', 'owh-node-label', '本地网络'), this.address]),
						E('span', { 'class': 'owh-wire', 'aria-hidden': 'true' }),
						E('div', { 'class': 'owh-router' }, [textNode('strong', '', '本机'), this.routeStatus]),
						E('span', { 'class': 'owh-wire', 'aria-hidden': 'true' }),
						E('div', { 'class': 'owh-endpoint' }, [textNode('span', 'owh-node-label', '默认网关'), this.gateway])
					]),
					E('div', { 'class': 'owh-network-meta' }, [E('div', {}, [textNode('span', '', 'LAN DHCPv4'), this.dhcp]), E('div', {}, [textNode('span', '', 'DNS 服务器'), this.dns])]),
					E('div', { 'class': 'owh-traffic-head' }, [textNode('h4', '', 'LAN 实时流量'), this.deviceName]),
					E('div', { 'class': 'owh-traffic-values' }, [E('div', {}, [textNode('span', 'owh-rx-label', '↓ 接收'), this.rx]), E('div', {}, [textNode('span', 'owh-tx-label', '↑ 发送'), this.tx])]),
					this.chart,
					textNode('p', 'owh-caption', 'LAN 接口统计，含局域网通信。')
				]),
				E('section', { 'class': 'cbi-section owh-panel owh-resources' }, [heading('设备状态'), this.cpu.root, this.memory.root, this.disk.root, E('div', { 'class': 'owh-uptime' }, [textNode('span', '', '持续运行'), this.elapsed])])
			]),
			E('section', { 'class': 'cbi-section owh-panel owh-tools' }, [
				E('div', {}, [heading('IP 与分流检测'), textNode('p', 'owh-caption', '使用在线工具查看当前浏览器的出口 IP、连通性与网站分流。')]),
				E('nav', { 'class': 'owh-tool-links', 'aria-label': '外部网络检测工具' }, [
					E('a', { 'class': 'btn owh-tool-link', href: 'https://ip.skk.moe/', target: '_blank', rel: 'noopener noreferrer' }, 'IP 与连通性 ↗'),
					E('a', { 'class': 'btn cbi-button-action owh-tool-link', href: 'https://ip.skk.moe/split-tunnel', target: '_blank', rel: 'noopener noreferrer' }, '网站分流测试 ↗')
				])
			]),
			E('div', { 'class': 'owh-bottom-grid' }, [
				E('section', { 'class': 'cbi-section owh-panel' }, [heading('常用应用'), apps]),
				E('section', { 'class': 'cbi-section owh-panel' }, [heading('网络接口'), this.interfaceList])
			]),
			E('section', { 'class': 'owh-system' }, [
				E('dl', {}, [keyValue('固件', firmware + ' ' + (release.version || '')), keyValue('内核', board.kernel, true), keyValue('平台', release.target || board.system, true), keyValue('构建', build.version || '—', true)]),
				shortcuts
			])
		]);
		this.updateLive(data[5]);
		poll.add(L.bind(this.refresh, this), 5);
		return E('div', {}, [E('h2', {}, '主页'), page]);
	}
});

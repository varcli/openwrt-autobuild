'use strict';
'require baseclass';
'require uci';

function list(value) { return Array.isArray(value) ? value.slice() : String(value || '').split(/\s+/).filter(Boolean); }
function section(snapshot, config, name) { return (snapshot[config] || []).find(function(s) { return s['.name'] === name; }) || {}; }
function ipv4(value) {
	if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value || '')) throw new Error('请输入有效的 IPv4 地址。');
	if (value.split('.').some(function(part) { return part.length > 1 && part[0] === '0'; })) throw new Error('IPv4 地址不能包含前导零。');
	var parts = value.split('.').map(Number);
	if (parts.some(function(part) { return part > 255; })) throw new Error('IPv4 地址每段必须为 0～255。');
	return parts.reduce(function(result, part) { return result * 256 + part; }, 0);
}
function subnet(address, mask) {
	var ip = ipv4(address), bits = ipv4(mask).toString(2).padStart(32, '0');
	if (!/^1{8,30}0+$/.test(bits)) throw new Error('子网掩码须连续，支持 /8～/30。');
	var prefix = bits.indexOf('0'), size = Math.pow(2, 32 - prefix), network = Math.floor(ip / size) * size;
	if (ip <= network || ip >= network + size - 1 || ip >= 3758096384 || ip < 16777216 || ip >>> 24 === 127 || ip >>> 16 === 43518)
		throw new Error('请使用可分配给设备的单播 IPv4 地址，不能是网络、广播、回环或链路本地地址。');
	return { ip: ip, network: network, last: network + size - 1, hosts: size - 2, prefix: prefix };
}
function dnsList(value) {
	var values = list(String(value || '').replace(/[,，]/g, ' '));
	if (!values.length) throw new Error('至少填写一个 IPv4 DNS 服务器。');
	values.forEach(function(value) {
		var ip = ipv4(value);
		if (ip === 0 || ip >= 3758096384 || ip >>> 24 === 127) throw new Error('DNS 服务器地址无效。');
	});
	return values;
}
function checkGateway(value, network) {
	var ip = ipv4(value);
	if (ip <= network.network || ip >= network.last || ip === network.ip) throw new Error('网关须与设备地址处于同一网段，且不能与设备地址相同。');
}
function portNames(devices) {
	return Object.keys(devices || {}).filter(function(name) { return /^(eth|en)[A-Za-z0-9_.:-]*$/.test(name); }).sort();
}
function addressConfig(config, fallback) {
	var value = (list(config.ipaddr)[0] || fallback).split('/'), prefix = Number(value[1]);
	var mask = config.netmask;
	if (!mask && value.length === 2 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
		var bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
		mask = [24, 16, 8, 0].map(function(shift) { return bits >>> shift & 255; }).join('.');
	}
	return { address: value[0], mask: mask || '255.255.255.0' };
}
function defaults(snapshot, ports) {
	var lan = section(snapshot, 'network', 'lan'), wan = section(snapshot, 'network', 'wan');
	var dhcp = section(snapshot, 'dhcp', 'lan'), lanDevice = lan.device || lan.ifname;
	var bridge = (snapshot.network || []).find(function(s) { return s['.type'] === 'device' && s.name === lanDevice && s.type === 'bridge'; });
	var lanPorts = list(bridge ? bridge.ports : lan.ifname || lan.device).filter(function(name) { return ports.indexOf(name) >= 0; });
	var wanPort = list(wan.device || wan.ifname).find(function(name) { return ports.indexOf(name) >= 0; }) || (ports.length > 1 ? ports[ports.length - 1] : '');
	var mode = ports.length > 1 && wan.proto && wan.proto !== 'none' && dhcp.ignore !== '1' ? 'router' : 'side';
	if (!lanPorts.length) lanPorts = ports.filter(function(name) { return mode !== 'router' || name !== wanPort; }).slice(0, 1);
	var lanAddress = addressConfig(lan, mode === 'side' ? '192.168.123.2' : '192.168.100.1'), wanAddress = addressConfig(wan, '');
	return {
		mode: mode, lanPorts: lanPorts, wanPort: wanPort, lanIP: lanAddress.address,
		lanMask: lanAddress.mask, gateway: lan.gateway || '192.168.123.1', dns: list(lan.dns).join(' ') || lan.gateway || '192.168.123.1',
		protocol: ['dhcp', 'static', 'pppoe'].indexOf(wan.proto) >= 0 ? wan.proto : 'dhcp',
		wanIP: wanAddress.address, wanMask: wanAddress.mask, wanGateway: wan.gateway || '',
		wanDNS: list(wan.dns).join(' '), username: wan.username || '', password: wan.password || ''
	};
}

function plan(input, snapshot, availablePorts) {
	var value = Object.assign({}, input), changes = [], lanNet;
	if (['side', 'router'].indexOf(value.mode) < 0) throw new Error('请选择运行模式。');
	value.lanPorts = list(value.lanPorts);
	if (!value.lanPorts.length) throw new Error('至少选择一个 LAN 网口。');
	var selected = value.lanPorts.concat(value.mode === 'router' ? [value.wanPort] : []);
	if (selected.some(function(name) { return availablePorts.indexOf(name) < 0; })) throw new Error('所选网口不存在，请刷新页面重新选择。');
	if (new Set(selected).size !== selected.length) throw new Error('LAN 和 WAN 不能使用相同网口。');
	selected.forEach(function(name) {
		if (selected.some(function(other) { return other !== name && other.indexOf(name + '.') === 0; })) throw new Error('不能同时使用物理网口及其 VLAN 子接口，请在高级网络设置中配置。');
	});
	lanNet = subnet(value.lanIP, value.lanMask);
	if (value.mode === 'side') { checkGateway(value.gateway, lanNet); value.dns = dnsList(value.dns); }
	else {
		if (['dhcp', 'static', 'pppoe'].indexOf(value.protocol) < 0) throw new Error('请选择上网方式。');
		if (value.protocol === 'static') {
			var wanNet = subnet(value.wanIP, value.wanMask);
			checkGateway(value.wanGateway, wanNet);
			if (lanNet.network <= wanNet.last && wanNet.network <= lanNet.last) throw new Error('LAN 与 WAN 网段不能重叠。');
			value.wanDNS = dnsList(value.wanDNS);
		}
		if (value.protocol === 'pppoe' && (!value.username || !value.password)) throw new Error('请填写宽带账号和密码。');
	}
	function change(config, sid, type, options) {
		var existing = section(snapshot, config, sid);
		if (existing['.type'] && existing['.type'] !== type) throw new Error('配置段 ' + sid + ' 已被其他功能占用，请使用高级网络设置。');
		changes.push({ config: config, section: sid, type: type, options: options });
	}
	var lan = section(snapshot, 'network', 'lan');
	var bridge = (snapshot.network || []).find(function(s) { return s['.type'] === 'device' && s.name === (lan.device || 'br-lan') && s.type === 'bridge'; });
	if (!bridge) bridge = (snapshot.network || []).find(function(s) { return s['.type'] === 'device' && s.name === 'br-lan' && s.type === 'bridge'; });
	var bridgeName = bridge ? bridge.name : 'br-lan', bridgeSID = bridge ? bridge['.name'] : 'home_lan_bridge';
	var occupied = section(snapshot, 'network', bridgeSID);
	if (!bridge && occupied.name && occupied.name !== bridgeName) throw new Error('向导的网桥配置段已被其他设备占用，请使用高级网络设置。');
	(snapshot.network || []).forEach(function(s) {
		if (s['.type'] === 'device' && s.name === bridgeName && s.type !== 'bridge') throw new Error('LAN 网桥名称已被其他设备占用，请使用高级网络设置。');
		if ((s['.type'] === 'bridge-vlan' && s.device === bridgeName) || (s['.name'] === bridgeSID && s.vlan_filtering === '1'))
			throw new Error('现有 LAN 网桥使用 VLAN 过滤，请使用高级网络设置。');
		if (s['.type'] === 'device' && s.type === 'bridge' && s['.name'] !== bridgeSID && list(s.ports).some(function(p) { return selected.indexOf(p) >= 0; }))
			throw new Error('所选网口已用于其他网桥，请在高级网络设置中调整。');
		if (s['.type'] === 'interface' && ['lan', 'wan', 'wan6', 'loopback'].indexOf(s['.name']) < 0 && list(s.device || s.ifname).some(function(p) { return selected.indexOf(p) >= 0 || p === bridgeName || p.indexOf(bridgeName + '.') === 0 || p === '@lan'; }))
			throw new Error('所选网口已用于其他网络，请在高级网络设置中调整。');
	});
	change('network', bridgeSID, 'device', { name: bridgeName, type: 'bridge', ports: value.lanPorts });
	change('network', 'lan', 'interface', { proto: 'static', device: bridgeName, ifname: null, type: null, disabled: null, auto: '1', ipaddr: value.lanIP, netmask: value.lanMask,
		broadcast: null, gateway: value.mode === 'side' ? value.gateway : null, dns: value.mode === 'side' ? value.dns : null, ip6assign: value.mode === 'router' ? '64' : null });
	['wan', 'wan6'].forEach(function(sid) {
		if (value.mode === 'side') {
			if (section(snapshot, 'network', sid)['.name']) change('network', sid, 'interface', { proto: 'none', auto: '0', defaultroute: '0' });
		}
		else if (sid === 'wan') {
			change('network', sid, 'interface', { device: value.wanPort, ifname: null, disabled: null, auto: '1', defaultroute: '1', proto: value.protocol,
				ipaddr: value.protocol === 'static' ? value.wanIP : null, netmask: value.protocol === 'static' ? value.wanMask : null,
				gateway: value.protocol === 'static' ? value.wanGateway : null, dns: value.protocol === 'static' ? value.wanDNS : null,
				peerdns: value.protocol === 'static' ? '0' : '1', username: value.protocol === 'pppoe' ? value.username : null,
				password: value.protocol === 'pppoe' ? value.password : null, ipv6: value.protocol === 'pppoe' ? 'auto' : null });
		}
		else change('network', sid, 'interface', { device: '@wan', ifname: null, proto: 'dhcpv6', auto: '1', disabled: null, defaultroute: '1' });
	});
	var routerHost = lanNet.ip - lanNet.network;
	var start = routerHost < 100 && lanNet.hosts >= 100 ? 100 : routerHost === 1 ? 2 : 1;
	var end = start < routerHost ? routerHost - 1 : lanNet.hosts;
	var dhcpOptions = { interface: 'lan', ignore: value.mode === 'side' ? '1' : '0', force: '0', dhcpv6: value.mode === 'side' ? 'disabled' : 'server', ra: value.mode === 'side' ? 'disabled' : 'server', ndp: 'disabled' };
	if (value.mode === 'router') Object.assign(dhcpOptions, { start: String(start), limit: String(Math.min(150, end - start + 1)), leasetime: '12h' });
	change('dhcp', 'lan', 'dhcp', dhcpOptions);
	var dnsmasq = (snapshot.dhcp || []).find(function(s) { return s['.type'] === 'dnsmasq'; });
	change('dhcp', dnsmasq ? dnsmasq['.name'] : 'home_dnsmasq', 'dnsmasq', { authoritative: value.mode === 'side' ? '0' : '1' });
	change('dhcp', 'openwrt_lan', 'domain', { name: 'openwrt.lan', ip: value.lanIP });
	['lan', 'wan'].forEach(function(name) {
		var zone = (snapshot.firewall || []).find(function(s) { return s['.type'] === 'zone' && s.name === name; });
		var networks = list(zone && zone.network), wanted = name === 'lan' ? ['lan'] : ['wan', 'wan6'];
		wanted.forEach(function(n) { if (networks.indexOf(n) < 0) networks.push(n); });
		var options = { name: name, network: networks, input: name === 'lan' ? 'ACCEPT' : 'REJECT', output: 'ACCEPT', forward: name === 'lan' ? 'ACCEPT' : 'REJECT' };
		if (name === 'wan' && value.mode === 'router') Object.assign(options, { masq: '1', mtu_fix: '1' });
		change('firewall', zone ? zone['.name'] : 'home_' + name, 'zone', options);
	});
	if (value.mode === 'router') {
		var forwarding = (snapshot.firewall || []).find(function(s) { return s['.type'] === 'forwarding' && s.src === 'lan' && s.dest === 'wan'; });
		change('firewall', forwarding ? forwarding['.name'] : 'home_lan_wan', 'forwarding', { src: 'lan', dest: 'wan', enabled: '1' });
	}
	change('home', 'main', 'settings', { completed: '1', mode: value.mode });
	return { value: value, changes: changes };
}
function stage(result) {
	result.changes.forEach(function(change) {
		if (!uci.get(change.config, change.section)) uci.add(change.config, change.type, change.section);
		Object.keys(change.options).forEach(function(option) {
			var value = change.options[option];
			if (value == null) uci.unset(change.config, change.section, option);
			else uci.set(change.config, change.section, option, value);
		});
	});
}

return baseclass.extend({ list: list, ipv4: ipv4, subnet: subnet, portNames: portNames, defaults: defaults, plan: plan, stage: stage });

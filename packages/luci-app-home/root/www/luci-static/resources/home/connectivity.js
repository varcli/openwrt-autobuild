'use strict';

// Requests originate in the browser, following its own DNS, proxy and gateway.
var targets = [
	{ name: '国内', provider: '腾讯 · IPv4', url: 'https://ipv4.gdt.qq.com/get_client_ip', format: 'plain' },
	{ name: '国外', provider: 'ipify · IPv4', url: 'https://api.ipify.org/?format=json', format: 'json' },
	{ name: 'Google', provider: 'www.google.com', url: 'https://www.google.com/generate_204', format: 'opaque' },
	{ name: 'X / Twitter', provider: 'x.com', url: 'https://x.com/favicon.ico', format: 'opaque' },
	{ name: 'ChatGPT', provider: 'chatgpt.com', url: 'https://chatgpt.com/cdn-cgi/trace', format: 'trace' }
];

function validIP(value) {
	if (typeof value !== 'string' || value.length > 45) return false;
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value))
		return value.split('.').every(function(part) { return Number(part) <= 255 && String(Number(part)) === part; });
	// URL's IPv6 parser rejects malformed groups, multiple :: and invalid lengths.
	try { return value.indexOf(':') >= 0 && new URL('https://[' + value + ']/').hostname.length > 2; }
	catch (e) { return false; }
}

function parseResult(format, text) {
	var ip, location = '';
	if (text.length > 8192) throw new Error('响应内容过长');
	if (format === 'json') ip = JSON.parse(text).ip;
	else if (format === 'trace') {
		ip = (/^ip=(.+)$/m.exec(text) || [])[1];
		location = (/^loc=([A-Z]{2})$/m.exec(text) || [])[1] || '';
	}
	else if (format === 'plain') ip = text.trim();
	else throw new Error('未知响应格式');
	if (!validIP(ip)) throw new Error('未返回有效 IP');
	return { ip: ip, location: location };
}

function probe(target) {
	var controller = new AbortController(), started = performance.now();
	var timer = setTimeout(function() { controller.abort(); }, 8000);
	return fetch(target.url + (target.url.indexOf('?') < 0 ? '?' : '&') + '_home=' + Date.now(), {
		mode: target.format === 'opaque' ? 'no-cors' : 'cors',
		credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal
	}).then(function(response) {
		if (target.format === 'opaque') {
			if (response.type !== 'opaque' && !response.ok) throw new Error('HTTP ' + response.status);
			return { responseOnly: true };
		}
		if (!response.ok) throw new Error('HTTP ' + response.status);
		return response.text().then(function(text) { return parseResult(target.format, text); });
	}).then(function(result) {
		result.ms = Math.max(1, Math.round(performance.now() - started));
		return result;
	}).catch(function(error) {
		return { error: error.name === 'AbortError' ? '8 秒超时' : '检测失败', detail: error.message || '请求失败' };
	}).finally(function() { clearTimeout(timer); });
}

function render() {
	var hidden = false, running = false;
	var cards = targets.map(function(target) {
		var address = E('strong', { 'class': 'owh-check-ip owh-mono' }, '—');
		var status = E('span', { 'class': 'owh-check-state' }, '未检测');
		var location = E('span', { 'class': 'owh-check-location' }, target.format === 'opaque' ? '不提供出口 IP' : target.provider);
		return { target: target, address: address, status: status, location: location,
			root: E('div', { 'class': 'owh-check-card' }, [
				E('div', { 'class': 'owh-check-title' }, [E('strong', {}, target.name), status]), address, location
			]) };
	});
	function showIP(card) { card.address.textContent = card.ip ? (hidden ? '••••••••' : card.ip) : '—'; }
	var conceal = E('button', { type: 'button', 'class': 'owh-check-button', 'aria-pressed': 'false', click: function() {
		hidden = !hidden;
		conceal.textContent = hidden ? '显示 IP' : '隐藏 IP';
		conceal.setAttribute('aria-pressed', String(hidden));
		cards.forEach(showIP);
	}}, '隐藏 IP');
	var updated = E('span', { 'class': 'owh-check-updated', role: 'status' }, '点击检测后查询');
	var check = E('button', { type: 'button', 'class': 'owh-check-button is-primary', click: function() {
		if (running) return;
		running = true; check.disabled = true; check.textContent = '检测中…';
		updated.textContent = '正在检测当前浏览器的访问链路';
		return Promise.all(cards.map(function(card) {
			card.ip = null; showIP(card); card.root.className = 'owh-check-card';
			card.status.textContent = '检测中'; card.location.textContent = card.target.provider;
			return probe(card.target).then(function(result) {
				card.root.title = result.error ? result.detail : card.target.provider;
				card.root.className = 'owh-check-card' + (result.error ? ' is-failed' : ' is-reachable');
				card.status.textContent = result.error || (result.responseOnly ? '有响应 · ' : '') + result.ms + ' ms';
				card.ip = result.ip || null; showIP(card);
				card.location.textContent = result.error ? '超时、网络、跨域限制或服务拒绝' :
					(result.responseOnly ? '不提供出口 IP · HTTP 状态不可读' : result.location || card.target.provider);
			});
		})).finally(function() {
			running = false; check.disabled = false; check.textContent = '重新检测';
			updated.textContent = '检测完成 · ' + new Date().toLocaleTimeString();
		});
	}}, '开始检测');
	return E('section', { 'class': 'owh-panel owh-checks' }, [
		E('div', { 'class': 'owh-section-title' }, [E('h3', {}, '出口 IP 与连通性'), E('div', { 'class': 'owh-check-actions' }, [conceal, check])]),
		E('div', { 'class': 'owh-check-grid', 'aria-live': 'polite' }, cards.map(function(card) { return card.root; })),
		E('div', { 'class': 'owh-check-footer' }, [
			E('p', { 'class': 'owh-caption' }, '当前浏览器出口 · 遵循当前代理与分流 · HTTP 请求耗时'), updated
		]),
		E('details', { 'class': 'owh-check-help' }, [E('summary', {}, '检测说明'),
			E('p', {}, '请求由当前浏览器发起，不代表路由器自身出口。国内/国外指查询服务，不保证出口所在地。Google/X 仅检查跨域响应，无法读取 HTTP 状态；ChatGPT 检查诊断接口，均不代表登录或解锁可用。')])
	]);
}

return { render: render, probe: probe, parseResult: parseResult, targets: targets };

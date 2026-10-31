'use strict';
'require view';
'require fs';
'require ui';
'require uci';
'require rpc';
'require poll';

// LuCI's authenticated file RPC is the only entry point; no standalone CGI.
var command = '/usr/bin/online-upgrade.sh';
var commitConfig = rpc.declare({ object: 'uci', method: 'commit', params: ['config'] });
var busyPhases = ['checking', 'selecting', 'downloading', 'verifying', 'flashing'];
var mirrorPrefixes = { direct: '', ghfast: 'https://ghfast.top/', ghproxy: 'https://gh-proxy.org/' };
var prefixPattern = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~%\/-]*)?$/;

function validPrefix(value) {
	return value.length <= 512 && prefixPattern.test(value);
}

function execute(args) {
	return fs.exec(command, args).then(function(result) {
		if (result.code !== 0)
			throw new Error(result.stderr || result.stdout || '操作未能启动。');
		return result.stdout;
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			fs.read('/usr/share/online-upgrade/build.json').then(JSON.parse),
			uci.load('online-upgrade')
		]);
	},

	refresh: function() {
		var self = this;
		return Promise.all([execute(['status']), execute(['log']), execute(['releases'])]).then(function(results) {
			var status = JSON.parse(results[0]);
			self.status = status;
			var releases = JSON.parse(results[2]);
			if (!Array.isArray(releases)) throw new Error('固件列表格式错误。');
			var catalog = releases.filter(function(release) {
				return !release.draft && !release.prerelease && Array.isArray(release.assets) && release.assets.some(function(asset) {
					return /^immortalwrt-[A-Za-z0-9._+-]+-x86-64-generic-squashfs-combined-efi\.img\.gz$/.test(asset.name);
				});
			}).sort(function(a, b) { return Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0); });
			var usable = catalog.filter(function(release) {
				return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(release.tag_name) && release.assets.some(function(asset) { return asset.name === 'x86-64-update.json'; });
			});
			var signature = JSON.stringify(catalog);
			if (signature !== self.catalogSignature) {
				self.catalogSignature = signature;
				self.selector.replaceChildren();
				catalog.forEach(function(release, index) {
					var valid = usable.indexOf(release) >= 0;
					self.selector.appendChild(E('option', { value: release.tag_name, disabled: valid ? null : true },
						(release.name || release.tag_name) + (index === 0 ? '（最新）' : '') + (valid ? '' : '（缺少更新清单）')));
				});
				self.selector.value = status.release_tag || (usable[0] && usable[0].tag_name) || '';
			}
			if (status.release_tag && busyPhases.indexOf(status.phase) < 0) self.selector.value = status.release_tag;
			self.message.textContent = status.message;
			self.message.className = 'ou-status alert-message' + (status.phase === 'error' ? ' error' : status.phase === 'ready' ? ' success' : '');
			self.filename.textContent = status.filename || '—';
			var selectedRelease = catalog.find(function(release) { return release.tag_name === status.release_tag; });
			var published = selectedRelease && new Date(selectedRelease.published_at);
			self.published.textContent = published && !isNaN(published.getTime()) ? published.toLocaleString() : '—';
			// Release 内容是不可信文本，不作为 HTML 注入，也不加载远程渲染脚本。
			self.notes.textContent = selectedRelease && typeof selectedRelease.body === 'string' && selectedRelease.body.trim() ?
				selectedRelease.body : '此版本暂无更新说明。';
			self.release.replaceChildren();
			if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\/[A-Za-z0-9._+-]+$/.test(status.release_url || ''))
				self.release.appendChild(E('a', { href: status.release_url, target: '_blank', rel: 'noopener noreferrer' }, '在 GitHub Releases 查看 ↗'));
			self.log.textContent = results[1] || '暂无日志。';
			var busy = busyPhases.indexOf(status.phase) >= 0;
			self.checkButton.disabled = busy || !self.writable;
			self.saveButton.disabled = busy || !self.writable;
			self.mirror.disabled = busy || !self.writable;
			self.customMirror.disabled = busy || !self.writable;
			self.repository.disabled = busy || !self.writable;
			self.selector.disabled = busy || !self.writable || !usable.length;
			self.downloadButton.disabled = !self.writable || status.phase !== 'available';
			self.upgradeButton.disabled = !self.writable || status.phase !== 'ready';
			if (status.phase === 'error') self.upgradeRequested = false;
			if (status.phase === 'flashing' && self.upgradeRequested) self.waitForReboot();
			if (status.phase === 'listed' && !self.autoSelecting) {
				if (!usable.length) { self.message.textContent = '最近 100 条发布中没有可在线更新的 x86 固件。旧固件缺少清单时仅供查看。'; return; }
				self.autoSelecting = true;
				self.selector.value = usable[0].tag_name;
				return execute(['select', usable[0].tag_name]).then(function() { return self.refresh(); })
					.finally(function() { self.autoSelecting = false; });
			}
			if (status.phase === 'idle' && !self.autoChecked) {
				self.autoChecked = true;
				return self.start('check');
			}
		}).catch(function(error) {
			if (self.upgradeRequested) self.waitForReboot();
			else self.message.textContent = '读取状态失败：' + error.message;
		});
	},

	waitForReboot: function() {
		if (this.waiting) return;
		this.waiting = true;
		ui.showModal('正在升级', [
			E('p', { 'class': 'spinning' }, '正在等待设备恢复连接，请勿断电。'),
			E('p', {}, '如果选择了不保留配置，需重新连接新固件的 LAN 地址。')
		]);
		if (this.keepSettings)
			ui.awaitReconnect(window.location.host);
		else
			ui.awaitReconnect(window.location.host, '192.168.123.2', '192.168.100.1');
	},

	start: function(action, tag) {
		var self = this;
		this.checkButton.disabled = this.downloadButton.disabled = this.upgradeButton.disabled = this.saveButton.disabled = true;
		var args = [action];
		if (action === 'select' || action === 'download') args.push(tag || this.selector.value);
		return execute(args).then(function() { return self.refresh(); }).catch(function(error) {
			ui.addNotification(null, E('p', {}, error.message));
			return self.refresh();
		});
	},

	confirmUpgrade: function() {
		var self = this;
		if (!this.status || this.status.phase !== 'ready') return;
		var selected = Object.assign({}, this.status);
		var selectedVersion = selected.version.split('.').map(Number);
		var currentVersion = this.currentVersion.split('.').map(Number);
		var older = selectedVersion[0] < currentVersion[0] || (selectedVersion[0] === currentVersion[0] && selectedVersion[1] < currentVersion[1]);
		var keep = E('input', { type: 'checkbox', checked: selected.allow_backup && !older ? true : null, disabled: selected.allow_backup ? null : true });
		var content = [
			E('p', {}, '即将安装构建 ' + selected.version + '，设备会重启并短暂断网。'),
			E('p', {}, selected.filename),
			E('p', {}, (selected.include_docker === 'true' ? '含 Docker' : '不含 Docker') + ' / ' + selected.rootfs_partsize + ' MB'),
			E('label', {}, [keep, ' 保留配置（按系统备份清单，不保留整个 overlay）']),
			E('p', {}, '继续前请在“备份/升级”页面下载一份配置备份。插件和代理内核以新固件为准。')
		];
		if (older) content.push(E('p', { 'class': 'alert-message warning' }, '正在回退到较早构建，配置可能不兼容，默认不保留配置。'));
		if (selected.layout_changed)
			content.push(E('p', { 'class': 'alert-message warning' }, '检测到分区布局变化，升级可能重写磁盘布局。请确认磁盘上没有需要保留的额外分区或数据。'));
		content.push(E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', click: ui.hideModal }, '取消'), ' ',
			E('button', { 'class': 'btn cbi-button-negative', click: function(event) {
				event.target.disabled = true;
				self.keepSettings = keep.checked;
				return execute(['upgrade', keep.checked ? 'keep' : 'reset', selected.release_tag, selected.sha256]).then(function() {
					self.upgradeRequested = true;
					ui.hideModal();
					return self.refresh();
				}).catch(function(error) {
					event.target.disabled = false;
					ui.addNotification(null, E('p', {}, error.message));
				});
			}}, '确认升级并重启')
		]));
		ui.showModal('确认固件升级', content);
	},

	render: function(data) {
		var self = this, build = data[0], writable = L.hasViewPermission();
		this.writable = writable;
		this.currentVersion = build.version;
		this.selector = E('select', { 'class': 'cbi-input-select', disabled: true, 'aria-label': '选择固件', change: function(event) {
			return self.start('select', event.target.value);
		}});
		var repository = E('input', {
			'class': 'cbi-input-text', value: uci.get('online-upgrade', 'main', 'repository') || build.repository,
			'aria-label': 'GitHub 仓库', disabled: writable ? null : true
		});
		this.repository = repository;
		var customMirrorDraft = uci.get('online-upgrade', 'main', 'custom_mirror') || '', previousMirror;
		function syncMirrorPrefix() {
			if (previousMirror === 'custom') customMirrorDraft = self.customMirror.value;
			var custom = self.mirror.value === 'custom';
			self.customMirror.value = custom ? customMirrorDraft : (mirrorPrefixes[self.mirror.value] || '');
			self.customMirror.readOnly = !custom || !writable;
			self.customMirror.placeholder = self.mirror.value === 'direct' ? '直连 GitHub，无镜像前缀' : 'https://mirror.example.com/';
			previousMirror = self.mirror.value;
		}
		this.mirror = E('select', { 'class': 'cbi-input-select', 'aria-label': 'GitHub 加速', disabled: writable ? null : true,
			change: syncMirrorPrefix
		}, [
			E('option', { value: 'direct' }, '禁用加速（直连 GitHub）'),
			E('option', { value: 'ghfast' }, 'ghfast.top'),
			E('option', { value: 'ghproxy' }, 'gh-proxy.org'),
			E('option', { value: 'custom' }, '自定义镜像')
		]);
		this.mirror.value = uci.get('online-upgrade', 'main', 'download_mirror') || 'direct';
		this.customMirror = E('input', {
			'class': 'cbi-input-text', 'aria-label': 'GitHub 加速前缀', disabled: writable ? null : true
		});
		syncMirrorPrefix();
		this.message = E('p', { 'class': 'ou-status alert-message', role: 'status', 'aria-live': 'polite' }, '点击检查更新。');
		this.filename = E('span', {}, '—');
		this.published = E('span', {}, '—');
		this.notes = E('div', { 'class': 'ou-release-notes' }, '选择版本后显示更新说明。');
		this.release = E('span', {}, '—');
		this.log = E('pre', { 'class': 'ou-log' }, '暂无日志。');
		this.saveButton = E('button', { 'class': 'btn', disabled: writable ? null : true, click: function() {
			var value = repository.value.trim();
			if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
				ui.addNotification(null, E('p', {}, '仓库格式应为 owner/repo。'));
				return;
			}
			var mirror = self.mirror.value, custom = (mirror === 'custom' ? self.customMirror.value : customMirrorDraft).trim();
			if (['direct', 'ghfast', 'ghproxy', 'custom'].indexOf(mirror) < 0 ||
				(mirror === 'custom' && !validPrefix(custom))) {
				ui.addNotification(null, E('p', {}, '加速地址应为 HTTPS 前缀，不能包含账号、查询参数或片段。'));
				return;
			}
			self.saveButton.disabled = true;
			uci.set('online-upgrade', 'main', 'repository', value);
			uci.set('online-upgrade', 'main', 'download_mirror', mirror);
			uci.set('online-upgrade', 'main', 'custom_mirror', custom);
			uci.unset('online-upgrade', 'main', 'api_mirror');
			return uci.save().then(function() { return commitConfig('online-upgrade'); }).then(function(result) {
				if (result && result.error) throw new Error('保存仓库配置失败。');
				return self.start('check');
			}).catch(function(error) {
				self.saveButton.disabled = false;
				ui.addNotification(null, E('p', {}, error.message));
			});
		}}, '保存并检查');
		this.checkButton = E('button', { 'class': 'btn cbi-button-action', disabled: writable ? null : true,
			click: function() { return self.start('check'); } }, '刷新固件列表');
		this.downloadButton = E('button', { 'class': 'btn cbi-button-action', disabled: true,
			click: function() { return self.start('download'); } }, '下载并校验');
		this.upgradeButton = E('button', { 'class': 'btn cbi-button-negative', disabled: true,
			click: function() { self.confirmUpgrade(); } }, '升级固件');

		function row(label, value) { return E('div', { 'class': 'ou-row' }, [E('div', { 'class': 'ou-label' }, label), E('div', { 'class': 'ou-value' }, value)]); }
		var page = E('div', { 'class': 'ou-page' }, [
			E('link', { rel: 'stylesheet', href: L.resource('online-upgrade/style.css') }),
			E('div', { 'class': 'ou-toolbar' }, [
				E('p', {}, '选择发布版本，下载校验后确认升级。支持 x86-64 / EFI / squashfs。'), this.checkButton
			]),
			E('section', { 'class': 'cbi-section ou-current' }, [
				E('div', {}, [E('span', { 'class': 'ou-label' }, '当前构建'), E('strong', { 'class': 'ou-build' }, build.version)]),
				E('div', {}, [E('span', { 'class': 'ou-label' }, '固件配置'), E('span', {}, (build.include_docker ? '含 Docker' : '不含 Docker') + ' / ' + build.rootfs_partsize + ' MB')]),
				E('div', {}, [E('span', { 'class': 'ou-label' }, '提交版本'), E('code', {}, (build.commit || '未知').slice(0, 12))])
			]),
			E('div', { 'class': 'ou-grid' }, [
				E('section', { 'class': 'cbi-section ou-panel' }, [
					E('h3', {}, '选择固件'),
					E('div', { 'class': 'ou-selection' }, this.selector),
					E('p', { 'class': 'ou-help' }, '默认选择最新可用构建，也可选择历史版本或切换 Docker 配置。'),
					E('div', { 'class': 'ou-metadata' }, [row('发布时间', this.published), row('镜像文件', this.filename)]),
					E('div', { 'class': 'ou-release' }, [E('h4', {}, '更新说明'), this.notes, this.release]),
					this.message,
					E('div', { 'class': 'ou-actions' }, [this.downloadButton, this.upgradeButton])
				]),
				E('section', { 'class': 'cbi-section ou-panel' }, [
					E('h3', {}, '更新源'),
					row('GitHub 仓库', repository), row('GitHub 加速', this.mirror), row('镜像前缀', this.customMirror),
					E('div', { 'class': 'ou-settings-action' }, this.saveButton),
					E('details', { 'class': 'ou-help' }, [
						E('summary', {}, '镜像地址说明'),
						E('p', {}, '保存并检查后生效。版本检查、更新清单和固件下载统一使用此地址；服务需同时支持 GitHub API 和 Release 下载。HTTPS 前缀后拼接完整原始 URL。'),
						E('p', {}, '镜像会转发清单和固件。SHA256 校验仍会执行，但不构成独立签名验证。')
					])
				])
			]),
			E('section', { 'class': 'cbi-section ou-panel ou-logs' }, [E('h3', {}, '操作日志'), this.log])
		]);
		if (writable) {
			poll.add(L.bind(this.refresh, this), 3);
			this.refresh();
		}
		return E('div', {}, [E('h2', {}, 'GitHub 固件更新'), page]);
	}
});

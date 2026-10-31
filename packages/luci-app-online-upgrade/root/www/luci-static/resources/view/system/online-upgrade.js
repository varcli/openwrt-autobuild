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
					self.selector.appendChild(E('option', { value: release.tag_name, disabled: !valid },
						(release.name || release.tag_name) + (index === 0 ? '（最新）' : '') + (valid ? '' : '（缺少更新清单）')));
				});
				self.selector.value = status.release_tag || (usable[0] && usable[0].tag_name) || '';
			}
			if (status.release_tag && busyPhases.indexOf(status.phase) < 0) self.selector.value = status.release_tag;
			self.targetConfig.textContent = status.include_docker == null ? '—' :
				(status.include_docker === 'true' ? '含 Docker' : '不含 Docker') + ' / ' + status.rootfs_partsize + ' MB';
			self.message.textContent = status.message;
			self.latest.textContent = status.version || '尚未查询';
			self.filename.textContent = status.filename || '—';
			self.checksum.textContent = status.sha256 || '—';
			self.release.replaceChildren();
			if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\/[A-Za-z0-9._+-]+$/.test(status.release_url || ''))
				self.release.appendChild(E('a', { href: status.release_url, target: '_blank', rel: 'noopener noreferrer' }, '查看本次构建与更新说明'));
			self.log.textContent = results[1] || '暂无日志。';
			var busy = busyPhases.indexOf(status.phase) >= 0;
			self.checkButton.disabled = busy;
			self.saveButton.disabled = busy;
			self.selector.disabled = busy || !usable.length;
			self.downloadButton.disabled = status.phase !== 'available';
			self.upgradeButton.disabled = status.phase !== 'ready';
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
		var keep = E('input', { type: 'checkbox', checked: !!selected.allow_backup && !older, disabled: !selected.allow_backup });
		var content = [
			E('p', {}, '即将安装构建 ' + selected.version + '，设备会重启并短暂断网。'),
			E('p', {}, selected.filename),
			E('p', {}, this.targetConfig.textContent),
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
		this.currentVersion = build.version;
		this.selector = E('select', { 'class': 'cbi-input-select', disabled: true, 'aria-label': '选择固件', change: function(event) {
			return self.start('select', event.target.value);
		}});
		this.targetConfig = E('span', {}, '—');
		var repository = E('input', {
			'class': 'cbi-input-text', value: uci.get('online-upgrade', 'main', 'repository') || build.repository,
			'aria-label': 'GitHub 仓库', disabled: !writable
		});
		this.message = E('p', { role: 'status', 'aria-live': 'polite' }, '点击检查更新。');
		this.latest = E('span', {}, '尚未查询');
		this.filename = E('span', {}, '—');
		this.checksum = E('code', { style: 'overflow-wrap:anywhere' }, '—');
		this.release = E('span', {}, '—');
		this.log = E('pre', { style: 'max-height:24em;overflow:auto;white-space:pre-wrap' }, '暂无日志。');
		this.saveButton = E('button', { 'class': 'btn', disabled: !writable, click: function() {
			var value = repository.value.trim();
			if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
				ui.addNotification(null, E('p', {}, '仓库格式应为 owner/repo。'));
				return;
			}
			self.saveButton.disabled = true;
			uci.set('online-upgrade', 'main', 'repository', value);
			return uci.save().then(function() { return commitConfig('online-upgrade'); }).then(function(result) {
				if (result && result.error) throw new Error('保存仓库配置失败。');
				return self.start('check');
			}).catch(function(error) {
				self.saveButton.disabled = false;
				ui.addNotification(null, E('p', {}, error.message));
			});
		}}, '保存并检查');
		this.checkButton = E('button', { 'class': 'btn cbi-button-action', disabled: !writable,
			click: function() { return self.start('check'); } }, '刷新固件列表');
		this.downloadButton = E('button', { 'class': 'btn cbi-button-action', disabled: true,
			click: function() { return self.start('download'); } }, '下载并校验');
		this.upgradeButton = E('button', { 'class': 'btn cbi-button-negative', disabled: true,
			click: function() { self.confirmUpgrade(); } }, '升级固件');

		function row(label, value) { return E('tr', {}, [E('th', { style: 'width:10em;text-align:left' }, label), E('td', {}, value)]); }
		var page = E('div', {}, [
			E('h2', {}, 'GitHub 固件更新'),
			E('p', {}, '列出最近 100 条发布中的 x86 固件，默认选择最新可用版本，可选择历史版本或不同 Docker 配置。仅支持 x86-64 / EFI / squashfs；下载校验完成后，仍需手动确认升级。'),
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table' }, [
					row('当前构建', build.version), row('提交版本', (build.commit || '未知').slice(0, 12)),
					row('固件配置', (build.include_docker ? '含 Docker' : '不含 Docker') + ' / ' + build.rootfs_partsize + ' MB'),
					row('GitHub 仓库', [repository, ' ', this.saveButton]), row('选择固件', this.selector), row('目标配置', this.targetConfig),
					row('目标构建', this.latest), row('镜像文件', this.filename), row('SHA256', this.checksum), row('更新说明', this.release)
				]),
				this.message,
				E('div', { 'class': 'cbi-page-actions' }, [this.checkButton, ' ', this.downloadButton, ' ', this.upgradeButton])
			]),
			E('h3', {}, '操作日志'), this.log
		]);
		if (writable) {
			poll.add(L.bind(this.refresh, this), 3);
			this.refresh();
		}
		return page;
	}
});

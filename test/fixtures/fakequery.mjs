#!/usr/bin/env node
/**
 * ServerQuery-Simulator (raw-Protokoll) mit erfundenen Daten – für Tests, Screenshots und die lokale Entwicklung
 * ohne echten TeamSpeak-Server. Nur fiktive Namen und RFC-5737-Adressen.
 *
 *   import { startFakeQuery } from './test/fixtures/fakequery.mjs';
 *   const fake = await startFakeQuery({ port: 0, password: 'testpw' });   // fake.port, fake.state, fake.close()
 *
 *   CLI:  node test/fixtures/fakequery.mjs --port 10099 --password testpw
 *
 * Zustand (Rechte, Nachrichten, Dateien) lebt im Speicher und lässt sich über `state` prüfen.
 */
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const OK = 'error id=0 msg=ok\n\r';
const EMPTY = 'error id=1281 msg=database\\sempty\\sresult\\sset\n\r';
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\//g, '\\/').replace(/ /g, '\\s').replace(/\|/g, '\\p').replace(/\n/g, '\\n');
const unesc = (v) => String(v).replace(/\\s/g, ' ').replace(/\\p/g, '|').replace(/\\\//g, '/').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
const row = (o) => Object.entries(o).map(([k, v]) => (v === '' || v === null || v === undefined ? k : `${k}=${esc(v)}`)).join(' ');
const rows = (list) => list.map(row).join('|') + '\n\r' + OK;
const err = (id, msg) => `error id=${id} msg=${esc(msg)}\n\r`;
const now = () => Math.floor(Date.now() / 1000);

export function createState() {
  const started = now() - 5 * 86400 - 3 * 3600 - 17 * 60;
  const CHANNELS = [
    { cid: 1, pid: 0, channel_order: 0, channel_name: 'Lobby', channel_topic: 'Welcome! Grab a seat.', channel_flag_default: 1, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 6, channel_needed_talk_power: 0, channel_maxclients: -1, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: -1 },
    { cid: 2, pid: 0, channel_order: 1, channel_name: '[cspacer]— Gaming —', channel_topic: '', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 6, channel_needed_talk_power: 0, channel_maxclients: 0, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: 99999 },
    { cid: 3, pid: 2, channel_order: 0, channel_name: 'Gaming 1', channel_topic: 'Co-op evening', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 8, channel_needed_talk_power: 0, channel_maxclients: 8, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: -1 },
    { cid: 4, pid: 2, channel_order: 3, channel_name: 'Gaming 2', channel_topic: '', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 8, channel_needed_talk_power: 0, channel_maxclients: 8, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: -1 },
    { cid: 5, pid: 2, channel_order: 4, channel_name: 'Competitive', channel_topic: 'Scrims only', channel_flag_default: 0, channel_flag_password: 1, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 5, channel_codec_quality: 10, channel_needed_talk_power: 25, channel_maxclients: 5, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: 3600 },
    { cid: 6, pid: 0, channel_order: 2, channel_name: '[cspacer]— Community —', channel_topic: '', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 6, channel_needed_talk_power: 0, channel_maxclients: 0, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: 99999 },
    { cid: 7, pid: 6, channel_order: 0, channel_name: 'Talk', channel_topic: 'Just chatting', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 7, channel_needed_talk_power: 0, channel_maxclients: -1, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: -1 },
    { cid: 8, pid: 6, channel_order: 7, channel_name: 'Music', channel_topic: 'Bot channel', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 0, channel_flag_semi_permanent: 1, channel_codec: 5, channel_codec_quality: 10, channel_needed_talk_power: 0, channel_maxclients: -1, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: 120 },
    { cid: 9, pid: 0, channel_order: 6, channel_name: 'AFK', channel_topic: 'Away from keyboard', channel_flag_default: 0, channel_flag_password: 0, channel_flag_permanent: 1, channel_flag_semi_permanent: 0, channel_codec: 4, channel_codec_quality: 1, channel_needed_talk_power: 100, channel_maxclients: -1, channel_maxfamilyclients: -1, channel_icon_id: 0, channel_needed_subscribe_power: 0, seconds_empty: -1 },
  ];
  const client = (o) => ({ client_type: 0, client_away: 0, client_away_message: '', client_flag_talking: 0, client_input_muted: 0, client_output_muted: 0, client_input_hardware: 1, client_output_hardware: 1, client_talk_power: 0, client_is_talker: 0, client_is_priority_speaker: 0, client_is_recording: 0, client_is_channel_commander: 0, client_servergroups: '8', client_channel_group_id: 8, client_version: '3.6.2 [Build: 1695203302]', client_platform: 'Windows', client_idle_time: 12000, client_created: started - 90 * 86400, client_lastconnected: now() - 3600, client_badges: '', ...o });
  const CLIENTS = [
    client({ clid: 11, cid: 3, client_database_id: 3, client_nickname: 'PixelPirate', client_unique_identifier: 'kQ3vH8sLxN2pT7wZaB5cR9dF1gY=', client_servergroups: '6,8', client_talk_power: 75, client_is_channel_commander: 1, client_country: 'DE', connection_client_ip: '203.0.113.24', client_idle_time: 4200, client_lastconnected: now() - 2 * 3600 - 340 }),
    client({ clid: 12, cid: 3, client_database_id: 7, client_nickname: 'Nova', client_unique_identifier: 'mW6yU1oEjC4rV0nQsK8hL3tX5bA=', client_country: 'AT', connection_client_ip: '198.51.100.14', client_platform: 'Linux', client_version: '3.6.1 [Build: 1690192672]', client_idle_time: 800, client_lastconnected: now() - 55 * 60 }),
    client({ clid: 13, cid: 4, client_database_id: 12, client_nickname: 'Quasar_42', client_unique_identifier: 'zP2dS9fGkM7aJ4eR1uT6yB0nH8c=', client_away: 1, client_away_message: 'brb', client_country: 'CH', connection_client_ip: '192.0.2.55', client_platform: 'macOS', client_idle_time: 610000, client_lastconnected: now() - 4 * 3600 }),
    client({ clid: 14, cid: 7, client_database_id: 19, client_nickname: 'RaccoonKing', client_unique_identifier: 'bT5rN0kX3sQ8vL2wD7mA1pF6eJ4=', client_input_muted: 1, client_country: 'NL', connection_client_ip: '203.0.113.140', client_servergroups: '7,8', client_talk_power: 50, client_idle_time: 20000, client_lastconnected: now() - 25 * 60 }),
    client({ clid: 15, cid: 9, client_database_id: 23, client_nickname: 'Lumen', client_unique_identifier: 'cE9wR4tY1uI7oP3aS6dF0gH2jK5=', client_away: 1, client_output_muted: 1, client_country: 'DE', connection_client_ip: '198.51.100.77', client_idle_time: 3400000, client_lastconnected: now() - 6 * 3600 }),
    client({ clid: 16, cid: 1, client_database_id: 31, client_nickname: 'Kite', client_unique_identifier: 'nL8mK2jH6gF4dS0aP9oI3uY7tR1=', client_country: 'FR', connection_client_ip: '192.0.2.201', client_platform: 'Android', client_version: '3.5.5 [Build: 1668494230]', client_idle_time: 90, client_created: now() - 600, client_lastconnected: now() - 600 }),
    { clid: 5, cid: 1, client_database_id: 1, client_nickname: 'Webinterface', client_type: 1, client_unique_identifier: 'serveradmin', client_servergroups: '2', client_channel_group_id: 8, client_idle_time: 0, client_created: 0, client_lastconnected: now(), client_platform: 'ServerQuery', client_version: 'ServerQuery', client_country: '', connection_client_ip: '127.0.0.1' },
  ];
  const DB_ONLY = [{ client_database_id: 41, client_nickname: 'Offline Otto', client_unique_identifier: 'dB0nLyUsEr00000000000000001=', client_created: started - 200 * 86400, client_lastconnected: started - 3 * 86400, connection_client_ip: '198.51.100.99', client_type: 0 }];
  const SERVER_GROUPS = [
    { sgid: 1, name: 'Guest Server Query', type: 2, iconid: 0, savedb: 0 }, { sgid: 2, name: 'Admin Server Query', type: 2, iconid: 0, savedb: 1 },
    { sgid: 6, name: 'Server Admin', type: 1, iconid: 500, savedb: 1 }, { sgid: 7, name: 'Moderator', type: 1, iconid: 300, savedb: 1 },
    { sgid: 8, name: 'Member', type: 1, iconid: 200, savedb: 1 }, { sgid: 9, name: 'Guest', type: 1, iconid: 0, savedb: 0 },
  ];
  const CHANNEL_GROUPS = [{ cgid: 5, name: 'Channel Admin', type: 1, iconid: 100, savedb: 1 }, { cgid: 6, name: 'Operator', type: 1, iconid: 0, savedb: 1 }, { cgid: 7, name: 'Voice', type: 1, iconid: 0, savedb: 1 }, { cgid: 8, name: 'Guest', type: 1, iconid: 0, savedb: 0 }];

  // Rechte-Definitionen (Auszug) und gesetzte Rechte je Subjekt (in-memory, veränderbar)
  const PERM_DEFS = [
    'b_serverinstance_help_view', 'b_serverinstance_version_view', 'b_serverinstance_info_view', 'b_serverquery_login', 'i_serverquery_view_power',
    'b_virtualserver_select', 'b_virtualserver_info_view', 'b_virtualserver_connectioninfo_view', 'b_virtualserver_channel_list', 'b_virtualserver_client_list',
    'b_virtualserver_servergroup_list', 'b_virtualserver_channelgroup_list', 'b_virtualserver_modify_name', 'b_virtualserver_snapshot_create', 'b_virtualserver_snapshot_deploy',
    'i_channel_min_depth', 'i_channel_max_depth', 'b_channel_create_child', 'b_channel_create_permanent', 'b_channel_create_semi_permanent', 'b_channel_create_temporary',
    'i_channel_create_modify_with_codec_maxquality', 'i_channel_needed_join_power', 'i_channel_join_power', 'i_channel_needed_subscribe_power', 'i_channel_subscribe_power', 'b_channel_modify_name', 'b_channel_delete_permanent',
    'i_group_member_add_power', 'i_group_needed_member_add_power', 'i_group_member_remove_power', 'i_group_needed_member_remove_power', 'i_group_modify_power', 'i_permission_modify_power', 'b_permission_modify_power_ignore',
    'i_client_max_clones_uid', 'i_client_max_idletime', 'i_client_talk_power', 'i_client_needed_talk_power', 'b_client_is_priority_speaker', 'i_client_kick_from_server_power', 'i_client_needed_kick_from_server_power', 'i_client_ban_power', 'i_client_needed_ban_power', 'i_client_move_power', 'i_client_needed_move_power', 'b_client_ignore_antiflood', 'i_client_private_textmessage_power', 'i_client_poke_power', 'b_client_offline_textmessage_send',
    'b_ft_ignore_password', 'i_ft_file_upload_power', 'i_ft_file_download_power', 'i_ft_file_delete_power', 'i_ft_quota_mb_download_per_client', 'i_ft_quota_mb_upload_per_client',
    'i_icon_id', 'i_max_icon_filesize', 'b_icon_manage', 'i_needed_modify_power_channel_delete_permanent',
  ].map((name, i) => ({ permid: 100 + i, permname: name, permdesc: `Description of ${name}` }));
  const perms = {
    servergroup: new Map([
      ['6', new Map([['b_virtualserver_select', [1, 0, 0]], ['i_permission_modify_power', [75, 0, 0]], ['i_client_kick_from_server_power', [75, 0, 0]], ['i_client_ban_power', [75, 0, 0]], ['b_channel_create_permanent', [1, 0, 0]], ['i_icon_id', [500, 0, 0]], ['i_group_modify_power', [75, 0, 0]], ['b_icon_manage', [1, 0, 0]]])],
      ['7', new Map([['b_virtualserver_select', [1, 0, 0]], ['i_client_kick_from_server_power', [50, 0, 0]], ['i_client_ban_power', [50, 0, 0]], ['i_client_move_power', [50, 0, 0]], ['i_icon_id', [300, 0, 0]], ['i_client_talk_power', [50, 0, 0]]])],
      ['8', new Map([['b_virtualserver_select', [1, 0, 0]], ['i_channel_join_power', [10, 0, 0]], ['i_icon_id', [200, 0, 0]], ['i_client_talk_power', [25, 0, 0]], ['i_client_private_textmessage_power', [25, 0, 0]]])],
      ['9', new Map([['b_virtualserver_select', [1, 0, 0]], ['i_client_talk_power', [0, 0, 0]]])],
    ]),
    channelgroup: new Map([['5', new Map([['i_channel_needed_join_power', [50, 0, 0]], ['b_channel_modify_name', [1, 0, 0]]])], ['6', new Map([['i_client_talk_power', [50, 0, 0]]])]]),
    client: new Map([['3', new Map([['i_client_talk_power', [75, 1, 0]]])]]),
    channel: new Map([['5', new Map([['i_channel_needed_join_power', [25, 0, 0]], ['i_channel_needed_subscribe_power', [25, 0, 0]]])]]),
    channelclient: new Map(),
  };
  const files = { // cid → path → [{ name, size, datetime, type }]
    '0': { '/': [{ name: 'icons', size: 0, datetime: started, type: 0 }, { name: 'avatar_a1b2c3', size: 18342, datetime: now() - 86400, type: 1 }], '/icons': [{ name: 'icon_200', size: 1024, datetime: started, type: 1 }, { name: 'icon_300', size: 2048, datetime: started, type: 1 }, { name: 'icon_500', size: 4096, datetime: started, type: 1 }] },
    '3': { '/': [{ name: 'screenshots', size: 0, datetime: now() - 3 * 86400, type: 0 }, { name: 'rules.txt', size: 812, datetime: now() - 30 * 86400, type: 1 }], '/screenshots': [{ name: 'boss-kill.png', size: 2_411_000, datetime: now() - 2 * 86400, type: 1 }, { name: 'loot.jpg', size: 933_120, datetime: now() - 36 * 3600, type: 1 }] },
    '7': { '/': [{ name: 'community-meeting-notes.pdf', size: 148_223, datetime: now() - 12 * 86400, type: 1 }] },
  };
  const messages = [ // Posteingang des Query-Kontos
    { msgid: 1, cluid: 'kQ3vH8sLxN2pT7wZaB5cR9dF1gY=', subject: 'Channel request', message: 'Hi! Could we get a second Gaming channel for the weekend event?', timestamp: now() - 2 * 86400, flag_read: 1 },
    { msgid: 2, cluid: 'bT5rN0kX3sQ8vL2wD7mA1pF6eJ4=', subject: 'Complaint about music bot', message: 'The music bot is way too loud in Talk again.', timestamp: now() - 5 * 3600, flag_read: 0 },
  ];
  return { started, CHANNELS, CLIENTS, DB_ONLY, SERVER_GROUPS, CHANNEL_GROUPS, PERM_DEFS, perms, files, messages, nextMsgId: 3, snapshots: 0, fails: new Map(), quits: 0 };
}

function handle(line, sock, st, password) {
  const [cmd, ...rest] = line.split(' ');
  const args = Object.fromEntries(rest.map((p) => { const j = p.indexOf('='); return j < 0 ? [p, ''] : [p.slice(0, j), unesc(p.slice(j + 1))]; }));
  const ip = sock.remoteAddress;
  const serverInfo = () => ({
    virtualserver_unique_identifier: 'q7Kx2mZpL0vR9tN4hB8cD3fG1jW=', virtualserver_name: 'Example Community', virtualserver_welcomemessage: 'Welcome to the Example Community server!', virtualserver_platform: 'Linux', virtualserver_version: '3.13.8 [Build: 1698322533]',
    virtualserver_maxclients: 64, virtualserver_password: '', virtualserver_clientsonline: 7, virtualserver_channelsonline: 9, virtualserver_created: st.started - 400 * 86400, virtualserver_uptime: now() - st.started, virtualserver_hostmessage: '', virtualserver_hostmessage_mode: 0,
    virtualserver_flag_password: 0, virtualserver_default_server_group: 8, virtualserver_default_channel_group: 8, virtualserver_default_channel_admin_group: 5, virtualserver_reserved_slots: 2,
    virtualserver_total_ping: 23.4, virtualserver_total_packetloss_total: 0.0012, virtualserver_queryclientsonline: 1, virtualserver_id: 1, virtualserver_port: 9987, virtualserver_status: 'online', virtualserver_autostart: 1, virtualserver_machine_id: '',
    virtualserver_total_bytes_uploaded: 48_318_382_080, virtualserver_total_bytes_downloaded: 61_204_339_712, connection_bandwidth_sent_last_second_total: 18_432, connection_bandwidth_received_last_second_total: 22_017,
    connection_bandwidth_sent_last_minute_total: 17_900, connection_bandwidth_received_last_minute_total: 21_500, connection_bytes_sent_total: 48_318_382_080, connection_bytes_received_total: 61_204_339_712, virtualserver_filebase: 'files/virtualserver_1',
    virtualserver_antiflood_points_tick_reduce: 5, virtualserver_antiflood_points_needed_command_block: 150, virtualserver_antiflood_points_needed_plugin_block: 300, virtualserver_antiflood_points_needed_ip_block: 250, virtualserver_complain_autoban_count: 5, virtualserver_complain_autoban_time: 1200, virtualserver_complain_remove_time: 3600,
    virtualserver_min_clients_in_channel_before_forced_silence: 100, virtualserver_priority_speaker_dimm_modificator: -18, virtualserver_max_download_total_bandwidth: -1, virtualserver_max_upload_total_bandwidth: -1, virtualserver_download_quota: -1, virtualserver_upload_quota: -1,
    virtualserver_log_client: 1, virtualserver_log_query: 0, virtualserver_log_channel: 1, virtualserver_log_permissions: 1, virtualserver_log_server: 1, virtualserver_log_filetransfer: 0, virtualserver_codec_encryption_mode: 0, virtualserver_needed_identity_security_level: 8, virtualserver_min_client_version: 0, virtualserver_channel_temp_delete_delay_default: 0, virtualserver_weblist_enabled: 0, virtualserver_name_phonetic: '', virtualserver_hostbanner_url: '', virtualserver_hostbanner_gfx_url: '', virtualserver_hostbanner_gfx_interval: 0, virtualserver_hostbanner_mode: 0, virtualserver_hostbutton_tooltip: '', virtualserver_hostbutton_url: '', virtualserver_hostbutton_gfx_url: '',
  });
  const hostInfo = () => ({ instance_uptime: now() - st.started - 60, host_timestamp_utc: now(), virtualservers_running_total: 1, virtualservers_total_maxclients: 64, virtualservers_total_clients_online: 7, virtualservers_total_channels_online: 9, connection_filetransfer_bandwidth_sent: 0, connection_filetransfer_bandwidth_received: 0, connection_filetransfer_bytes_sent_total: 1_258_291, connection_filetransfer_bytes_received_total: 6_291_456, connection_packets_sent_total: 0, connection_bytes_sent_total: 48_318_382_080, connection_packets_received_total: 0, connection_bytes_received_total: 61_204_339_712, connection_bandwidth_sent_last_second_total: 18_432, connection_bandwidth_sent_last_minute_total: 17_900, connection_bandwidth_received_last_second_total: 22_017, connection_bandwidth_received_last_minute_total: 21_500 });
  const dbInfo = (cldbid) => {
    const c = [...st.CLIENTS, ...st.DB_ONLY].find((x) => String(x.client_database_id) === String(cldbid));
    if (!c) return null;
    return { client_unique_identifier: c.client_unique_identifier, client_nickname: c.client_nickname, client_database_id: c.client_database_id, client_created: c.client_created, client_lastconnected: c.client_lastconnected, client_totalconnections: 42 + Number(cldbid), client_flag_avatar: '', client_description: '', client_month_bytes_uploaded: 0, client_month_bytes_downloaded: 0, client_total_bytes_uploaded: 22_020_096, client_total_bytes_downloaded: 96_468_992, client_base64HashClientUID: '', client_lastip: c.connection_client_ip };
  };
  const permList = (kind, id) => {
    const m = st.perms[kind].get(String(id));
    if (!m || m.size === 0) return EMPTY;
    return rows([...m.entries()].map(([name, [v, s, n]]) => ({ permid: st.PERM_DEFS.find((d) => d.permname === name)?.permid ?? 0, permsid: name, permvalue: v, permnegated: n, permskip: s })));
  };
  const permAdd = (kind, id) => {
    if (!st.perms[kind].has(String(id))) st.perms[kind].set(String(id), new Map());
    const name = args.permsid;
    if (!name || !st.PERM_DEFS.some((d) => d.permname === name)) return err(2562, 'invalid permission id');
    st.perms[kind].get(String(id)).set(name, [Number(args.permvalue ?? 0), Number(args.permskip ?? 0), Number(args.permnegated ?? 0)]);
    return OK;
  };
  const permDel = (kind, id) => {
    const m = st.perms[kind].get(String(id));
    if (!m || !m.has(args.permsid)) return err(2561, 'permission not found');
    m.delete(args.permsid);
    return OK;
  };
  const groupExists = (kind, id) => (kind === 'servergroup' ? st.SERVER_GROUPS : st.CHANNEL_GROUPS).some((g) => String(g.sgid ?? g.cgid) === String(id));

  switch (cmd) {
    case 'login': {
      const pw = args.client_login_password ?? rest[1];
      const user = args.client_login_name ?? rest[0];
      if (user === 'serveradmin' && pw === password) { st.fails.set(ip, 0); return OK; }
      const n = (st.fails.get(ip) || 0) + 1; st.fails.set(ip, n);
      if (n > 5) return 'error id=3329 msg=connection\\sfailed,\\syou\\sare\\sbanned extra_msg=you\\smay\\sretry\\sin\\s600\\sseconds\n\r';
      return err(520, 'invalid loginname or password');
    }
    case 'use': case 'clientupdate': case 'servernotifyregister': case 'servernotifyunregister': case 'logout': return OK;
    case 'serverlist': return rows([{ virtualserver_id: 1, virtualserver_port: 9987, virtualserver_status: 'online', virtualserver_clientsonline: 7, virtualserver_queryclientsonline: 1, virtualserver_maxclients: 64, virtualserver_uptime: now() - st.started, virtualserver_name: 'Example Community', virtualserver_autostart: 1, virtualserver_machine_id: '', virtualserver_unique_identifier: 'q7Kx2mZpL0vR9tN4hB8cD3fG1jW=' }, { virtualserver_id: 2, virtualserver_port: 9988, virtualserver_status: 'offline', virtualserver_clientsonline: 0, virtualserver_queryclientsonline: 0, virtualserver_maxclients: 16, virtualserver_uptime: 0, virtualserver_name: 'Event server', virtualserver_autostart: 0, virtualserver_machine_id: '', virtualserver_unique_identifier: 'e2Vx9nZpL0vR9tN4hB8cD3fG1jQ=' }]);
    case 'version': return 'version=3.13.8 build=1698322533 platform=Linux\n\r' + OK;
    case 'whoami': return 'virtualserver_status=online virtualserver_id=1 virtualserver_unique_identifier=q7Kx2mZpL0vR9tN4hB8cD3fG1jW= virtualserver_port=9987 client_id=5 client_channel_id=1 client_nickname=Webinterface client_database_id=1 client_login_name=serveradmin client_unique_identifier=serveradmin client_origin_server_id=0\n\r' + OK;
    case 'serverinfo': return rows([serverInfo()]);
    case 'hostinfo': return rows([hostInfo()]);
    case 'instanceinfo': return rows([{ serverinstance_database_version: 36, serverinstance_filetransfer_port: 30033, serverinstance_max_download_total_bandwidth: -1, serverinstance_max_upload_total_bandwidth: -1, serverinstance_guest_serverquery_group: 1, serverinstance_serverquery_flood_commands: 50, serverinstance_serverquery_flood_time: 3, serverinstance_serverquery_ban_time: 600, serverinstance_template_serveradmin_group: 3, serverinstance_template_serverdefault_group: 5, serverinstance_template_channeladmin_group: 1, serverinstance_template_channeldefault_group: 4, serverinstance_permissions_version: 24, serverinstance_pending_connections_per_ip: 0, serverinstance_serverquery_max_connections_per_ip: 5 }]);
    case 'channellist': return rows(st.CHANNELS.map((c) => ({ ...c, total_clients: st.CLIENTS.filter((x) => x.cid === c.cid && x.client_type === 0).length, total_clients_family: st.CLIENTS.filter((x) => x.cid === c.cid).length })));
    case 'channelinfo': { const c = st.CHANNELS.find((x) => String(x.cid) === String(args.cid)); return c ? rows([{ ...c, channel_filepath: `files/virtualserver_1/channel_${c.cid}`, channel_password: '', channel_description: '', channel_security_salt: '', channel_forced_silence: 0, channel_name_phonetic: '', channel_delete_delay: 0, channel_flag_maxclients_unlimited: 1, channel_flag_maxfamilyclients_unlimited: 1, channel_flag_maxfamilyclients_inherited: 0 }]) : err(768, 'invalid channelID'); }
    case 'clientlist': return rows(st.CLIENTS);
    case 'clientinfo': { const c = st.CLIENTS.find((x) => String(x.clid) === String(args.clid)); return c ? rows([{ ...c, client_lastip: c.connection_client_ip }]) : err(512, 'invalid clientID'); }
    case 'servergrouplist': return rows(st.SERVER_GROUPS);
    case 'channelgrouplist': return rows(st.CHANNEL_GROUPS);
    case 'servergroupsbyclientid': { const c = st.CLIENTS.find((x) => String(x.client_database_id) === String(args.cldbid)); const ids = (c?.client_servergroups || '8').split(','); return rows(ids.map((id) => { const g = st.SERVER_GROUPS.find((s) => String(s.sgid) === id); return { name: g?.name || 'Member', sgid: id, cldbid: args.cldbid }; })); }
    case 'servergroupclientlist': { const list = st.CLIENTS.filter((c) => c.client_type === 0 && (c.client_servergroups || '').split(',').includes(String(args.sgid))); return list.length ? rows(list.map((c) => ({ cldbid: c.client_database_id, client_nickname: c.client_nickname, client_unique_identifier: c.client_unique_identifier }))) : EMPTY; }
    case 'clientdbfind': {
      const pat = String(args.pattern || '').replace(/%/g, '');
      const uidMode = rest.includes('-uid');
      const pool = [...st.CLIENTS.filter((c) => c.client_type === 0), ...st.DB_ONLY];
      const hits = pool.filter((c) => (uidMode ? c.client_unique_identifier === pat : c.client_nickname.toLowerCase().includes(pat.toLowerCase())));
      return hits.length ? rows(hits.map((c) => ({ cldbid: c.client_database_id, name: c.client_nickname }))) : EMPTY;
    }
    case 'clientdbinfo': { const ids = String(args.cldbid || '').split('|').map((x) => x.replace(/^cldbid=/, '')); const infos = ids.map(dbInfo).filter(Boolean); return infos.length ? rows(infos) : err(512, 'invalid clientID'); }
    case 'clientdblist': return rows(st.CLIENTS.filter((c) => c.client_type === 0).map((c) => ({ cldbid: c.client_database_id, client_unique_identifier: c.client_unique_identifier, client_nickname: c.client_nickname, client_created: c.client_created, client_lastconnected: c.client_lastconnected, client_totalconnections: 42 + c.client_database_id, client_description: '', client_lastip: c.connection_client_ip })));
    case 'clientgetnamefromuid': { const c = [...st.CLIENTS, ...st.DB_ONLY].find((x) => x.client_unique_identifier === args.cluid); return c ? rows([{ cluid: c.client_unique_identifier, cldbid: c.client_database_id, name: c.client_nickname }]) : err(512, 'invalid clientID'); }
    case 'banlist': return rows([{ banid: 4, ip: '', name: '', uid: 'xX7dFgH2kLmN9pQrS4tUvW1yZ3a=', mytsid: '', lastnickname: 'SpamBot3000', created: now() - 2 * 86400, duration: 0, invokername: 'Moderator', invokercldbid: 7, invokeruid: 'mW6yU1oEjC4rV0nQsK8hL3tX5bA=', reason: 'Advertising', enforcements: 3 }]);
    case 'complainlist': return rows([{ tcldbid: 12, tname: 'Quasar_42', fcldbid: 19, fname: 'RaccoonKing', message: 'Loud music in Talk', timestamp: now() - 5 * 3600 }]);
    case 'logview': return rows([{ last_pos: 0, file_size: 4096, l: `${new Date().toISOString().replace('T', ' ').slice(0, 19)}|INFO    |VirtualServer |1  |client connected 'Kite'(id:31) from 192.0.2.201` }]);
    // Rechte
    case 'permissionlist': return rows(st.PERM_DEFS);
    case 'servergrouppermlist': return groupExists('servergroup', args.sgid) ? permList('servergroup', args.sgid) : err(2560, 'invalid groupID');
    case 'servergroupaddperm': return groupExists('servergroup', args.sgid) ? permAdd('servergroup', args.sgid) : err(2560, 'invalid groupID');
    case 'servergroupdelperm': return permDel('servergroup', args.sgid);
    case 'channelgrouppermlist': return groupExists('channelgroup', args.cgid) ? permList('channelgroup', args.cgid) : err(2560, 'invalid groupID');
    case 'channelgroupaddperm': return groupExists('channelgroup', args.cgid) ? permAdd('channelgroup', args.cgid) : err(2560, 'invalid groupID');
    case 'channelgroupdelperm': return permDel('channelgroup', args.cgid);
    case 'clientpermlist': return permList('client', args.cldbid);
    case 'clientaddperm': return permAdd('client', args.cldbid);
    case 'clientdelperm': return permDel('client', args.cldbid);
    case 'channelpermlist': return permList('channel', args.cid);
    case 'channeladdperm': return permAdd('channel', args.cid);
    case 'channeldelperm': return permDel('channel', args.cid);
    case 'channelclientpermlist': return permList('channelclient', `${args.cid}:${args.cldbid}`);
    case 'channelclientaddperm': return permAdd('channelclient', `${args.cid}:${args.cldbid}`);
    case 'channelclientdelperm': return permDel('channelclient', `${args.cid}:${args.cldbid}`);
    case 'permoverview': return EMPTY;
    // Dateien
    case 'ftgetfilelist': {
      const cid = String(args.cid ?? '0');
      let p = String(args.path || '/').replace(/\/+$/, '') || '/';
      const dir = st.files[cid]?.[p];
      if (!st.files[cid] && p === '/') return EMPTY;
      if (!dir) return err(2051, 'invalid file path');
      return dir.length ? rows(dir.map((f) => ({ cid, path: p, ...f }))) : EMPTY;
    }
    case 'ftdeletefile': {
      const cid = String(args.cid ?? '0');
      const full = String(args.name || '');
      const dir = full.slice(0, full.lastIndexOf('/')) || '/';
      const name = full.slice(full.lastIndexOf('/') + 1);
      const list = st.files[cid]?.[dir];
      if (!list || !list.some((f) => f.name === name)) return err(2050, 'file not found');
      st.files[cid][dir] = list.filter((f) => f.name !== name);
      return OK;
    }
    // Offline-Nachrichten
    case 'messagelist': return st.messages.length ? rows(st.messages.map(({ message, ...m }) => m)) : EMPTY;
    case 'messageget': { const m = st.messages.find((x) => String(x.msgid) === String(args.msgid)); return m ? rows([{ msgid: m.msgid, cluid: m.cluid, subject: m.subject, message: m.message, timestamp: m.timestamp }]) : err(1281, 'database empty result set'); }
    case 'messageadd': {
      const c = [...st.CLIENTS, ...st.DB_ONLY].find((x) => x.client_unique_identifier === args.cluid);
      if (!c) return err(512, 'invalid clientID');
      st.messages.push({ msgid: st.nextMsgId++, cluid: args.cluid, subject: args.subject || '', message: args.message || '', timestamp: now(), flag_read: 0, outgoing: true });
      return OK;
    }
    case 'messageupdateflag': { const m = st.messages.find((x) => String(x.msgid) === String(args.msgid)); if (!m) return err(1281, 'database empty result set'); m.flag_read = Number(args.flag ?? 1) ? 1 : 0; return OK; }
    case 'messagedel': { const i = st.messages.findIndex((x) => String(x.msgid) === String(args.msgid)); if (i < 0) return err(1281, 'database empty result set'); st.messages.splice(i, 1); return OK; }
    // Snapshots
    case 'serversnapshotcreate': st.snapshots += 1; return `version=3 salt=ZmFrZXNhbHQ= data=${esc(Buffer.from(JSON.stringify({ fake: true, n: st.snapshots, channels: st.CHANNELS.length })).toString('base64'))}\n\r` + OK;
    case 'serversnapshotdeploy': return OK;
    case 'quit': st.quits += 1; return null;
    default: return OK;
  }
}

/** Startet den Simulator; port 0 wählt einen freien Port. */
export function startFakeQuery({ port = 0, host = '127.0.0.1', password = 'testpw', state = createState() } = {}) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => {
      sock.setEncoding('utf8');
      sock.write('TS3\n\rWelcome to the TeamSpeak 3 ServerQuery interface, type "help" for a list of commands and "help <command>" for information on a specific command.\n\r');
      let buf = '';
      sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '').trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const out = handle(line, sock, state, password);
          if (out === null) { sock.write(OK); sock.end(); } else sock.write(out);
        }
      });
      sock.on('error', () => {});
    });
    server.on('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({ port: actual, host, state, close: () => new Promise((r) => { server.close(() => r()); }) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
  const port = Number(opt('port', process.env.PORT || 10011));
  const password = opt('password', process.env.PASSWORD || 'testpw');
  startFakeQuery({ port, password }).then((f) => console.log(`fake ServerQuery on 127.0.0.1:${f.port}`));
}

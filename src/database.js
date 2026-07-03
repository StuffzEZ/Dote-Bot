import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'conversations.db');

let db;

export function initDatabase() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      voice_channel_id TEXT,
      text_channel_id TEXT,
      title TEXT,
      description TEXT,
      importance INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      text TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_segments_conversation ON segments(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tags_conversation ON tags(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_guild ON conversations(guild_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_text_channel ON conversations(text_channel_id);

    CREATE TABLE IF NOT EXISTS dote_channels (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, channel_id)
    );
  `);

  log.info('Database initialized');
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function createConversation({ id, guildId, voiceChannelId, textChannelId, startedAt }) {
  const stmt = getDb().prepare(`
    INSERT INTO conversations (id, guild_id, voice_channel_id, text_channel_id, started_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, guildId, voiceChannelId || null, textChannelId || null, startedAt);
  log.debug(`Created conversation ${id}`);
}

export function endConversation({ id, endedAt }) {
  const stmt = getDb().prepare(`
    UPDATE conversations SET ended_at = ? WHERE id = ?
  `);
  stmt.run(endedAt, id);
}

export function updateConversationMetadata({ id, title, description, importance }) {
  const stmt = getDb().prepare(`
    UPDATE conversations SET title = ?, description = ?, importance = ? WHERE id = ?
  `);
  stmt.run(title, description, importance, id);
}

export function addSegment({ conversationId, userId, username, startTime, endTime, text }) {
  const stmt = getDb().prepare(`
    INSERT INTO segments (conversation_id, user_id, username, start_time, end_time, text)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(conversationId, userId, username, startTime, endTime, text);
}

export function addTag({ conversationId, tag }) {
  const stmt = getDb().prepare(`
    INSERT INTO tags (conversation_id, tag) VALUES (?, ?)
  `);
  stmt.run(conversationId, tag);
}

export function getConversation(id) {
  return getDb().prepare(`
    SELECT * FROM conversations WHERE id = ?
  `).get(id);
}

export function getConversationSegments(conversationId) {
  return getDb().prepare(`
    SELECT * FROM segments WHERE conversation_id = ? ORDER BY start_time
  `).all(conversationId);
}

export function getConversationTags(conversationId) {
  return getDb().prepare(`
    SELECT tag FROM tags WHERE conversation_id = ?
  `).all(conversationId).map(r => r.tag);
}

export function getConversationsByGuild(guildId) {
  return getDb().prepare(`
    SELECT * FROM conversations WHERE guild_id = ? ORDER BY started_at DESC
  `).all(guildId);
}

export function getConversationsByTextChannel(textChannelId) {
  return getDb().prepare(`
    SELECT * FROM conversations WHERE text_channel_id = ? ORDER BY started_at DESC
  `).all(textChannelId);
}

export function searchConversations(guildId, query) {
  return getDb().prepare(`
    SELECT DISTINCT c.* FROM conversations c
    JOIN segments s ON c.id = s.conversation_id
    WHERE c.guild_id = ? AND (
      c.title LIKE ? OR
      c.description LIKE ? OR
      s.text LIKE ?
    )
    ORDER BY c.importance DESC, c.started_at DESC
    LIMIT 10
  `).all(guildId, `%${query}%`, `%${query}%`, `%${query}%`);
}

export function getImportantConversations(guildId, limit = 5) {
  return getDb().prepare(`
    SELECT * FROM conversations
    WHERE guild_id = ? AND importance >= 7
    ORDER BY importance DESC, started_at DESC
    LIMIT ?
  `).all(guildId, limit);
}

export function getRecentConversations(guildId, limit = 5) {
  return getDb().prepare(`
    SELECT * FROM conversations
    WHERE guild_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(guildId, limit);
}

export function addDoteChannel(guildId, channelId) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO dote_channels (guild_id, channel_id) VALUES (?, ?)
  `);
  stmt.run(guildId, channelId);
}

export function getDoteChannels(guildId) {
  return getDb().prepare(`
    SELECT channel_id FROM dote_channels WHERE guild_id = ?
  `).all(guildId).map(r => r.channel_id);
}

export function isDoteChannel(channelId) {
  return getDb().prepare(`
    SELECT 1 FROM dote_channels WHERE channel_id = ?
  `).get(channelId) !== undefined;
}

export function removeDoteChannel(channelId) {
  getDb().prepare(`
    DELETE FROM dote_channels WHERE channel_id = ?
  `).run(channelId);
}

export function closeDatabase() {
  if (db) {
    db.close();
    log.info('Database closed');
  }
}

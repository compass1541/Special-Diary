/**
 * Storage Module - IndexedDB for diary entries
 */

import { createBackup, parseBackup } from './backup.js';

const DB_NAME = 'SpecialDiaryDB';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

export class DiaryStorage {
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('date', 'date', { unique: false });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    console.log('Object store created');
                }
            };
        });
    }

    async ensureReady() {
        await this.initPromise;
    }

    /**
     * Save or update a diary entry
     */
    async saveEntry(entry) {
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const now = Date.now();
            const entryData = {
                ...entry,
                updatedAt: now,
                createdAt: entry.createdAt || now
            };

            const request = store.put(entryData);

            request.onsuccess = () => {
                resolve(entryData);
            };

            request.onerror = () => {
                console.error('Failed to save entry:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get a diary entry by date string (YYYY-MM-DD)
     */
    async getEntry(dateId) {
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(dateId);

            request.onsuccess = () => {
                resolve(request.result || null);
            };

            request.onerror = () => {
                console.error('Failed to get entry:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get all diary entries
     */
    async getAllEntries() {
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result || [];
                // Sort by date descending
                entries.sort((a, b) => new Date(b.date) - new Date(a.date));
                resolve(entries);
            };

            request.onerror = () => {
                console.error('Failed to get all entries:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Delete a diary entry
     */
    async deleteEntry(dateId) {
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(dateId);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to delete entry:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get entries for a specific month
     */
    async getEntriesForMonth(year, month) {
        const allEntries = await this.getAllEntries();
        return allEntries.filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate.getFullYear() === year && entryDate.getMonth() === month;
        });
    }

    /**
     * Get dates that have entries (for calendar dots)
     */
    async getDatesWithEntries() {
        const allEntries = await this.getAllEntries();
        return new Set(allEntries.map(entry => entry.id));
    }

    /**
     * Search entries by text content
     */
    async searchEntries(query) {
        const allEntries = await this.getAllEntries();
        const lowerQuery = query.toLowerCase();

        return allEntries.filter(entry => {
            const content = (entry.content || '').toLowerCase();
            const comment = (entry.dailyComment || '').toLowerCase();
            return content.includes(lowerQuery) || comment.includes(lowerQuery);
        });
    }

    /**
     * Export all data as JSON
     */
    async exportData() {
        const entries = await this.getAllEntries();
        return createBackup(entries);
    }

    /**
     * Import already validated entries in one atomic IndexedDB transaction.
     */
    async importEntries(entries) {
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            for (const entry of entries) {
                store.put(entry);
            }

            transaction.oncomplete = () => resolve(entries.length);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('가져오기 저장이 취소되었습니다.'));
        });
    }

    /**
     * Parse, validate, and import a versioned or legacy JSON backup.
     */
    async importData(jsonString) {
        const entries = parseBackup(jsonString);
        return this.importEntries(entries);
    }
}

// Global storage instance
export const storage = new DiaryStorage();

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const styles = readFileSync(stylesPath, 'utf8');
const mobileStyles = styles.slice(styles.indexOf('@media (max-width: 768px)'));

describe('mobile responsive layout', () => {
    it('uses a dynamic viewport and makes the list sidebar scrollable', () => {
        expect(mobileStyles).toContain('height: 100dvh;');
        expect(mobileStyles).toMatch(
            /\.app-container:not\(\.editor-active\) \.sidebar\s*\{[^}]*overflow-y: auto;/s
        );
        expect(mobileStyles).toMatch(
            /\.entries-section\s*\{[^}]*overflow: visible;/s
        );
    });

    it('reserves safe-area space for mobile editing and modal content', () => {
        expect(mobileStyles).toContain('env(safe-area-inset-bottom)');
        expect(mobileStyles).toMatch(
            /\.modal-overlay\s*\{[^}]*height: 100dvh;/s
        );
    });

    it('wraps graph controls and confines the graph modal to overlay content', () => {
        expect(mobileStyles).toMatch(
            /\.graph-controls\s*\{[^}]*display: grid;/s
        );
        expect(mobileStyles).toMatch(
            /\.graph-filter\s*\{[^}]*flex-wrap: wrap;/s
        );
        expect(mobileStyles).toMatch(
            /\.modal\s*\{[^}]*max-height: 100%/s
        );
        expect(mobileStyles).toMatch(
            /\.graph-modal\s*\{[^}]*height: 100% !important;/s
        );
    });
});

/**
 * Google Gemini API Module
 * 
 * Uses @google/generative-ai package
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

// 환경 변수에서 API 키 로드
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

class GeminiAI {
    constructor() {
        this.model = null;
        this.init();
    }

    init() {
        if (!API_KEY || API_KEY.includes('your-gemini-api-key')) {
            console.warn('⚠️ Gemini API 키가 설정되지 않았습니다. .env 파일에 VITE_GEMINI_API_KEY를 설정하세요.');
            return;
        }

        try {
            const genAI = new GoogleGenerativeAI(API_KEY);
            this.model = genAI.getGenerativeModel({ model: "gemini-pro" });
            console.log('✨ Gemini AI initialized');
        } catch (error) {
            console.error('Gemini init failed:', error);
        }
    }

    isReady() {
        return !!this.model;
    }

    /**
     * 일기 내용을 기반으로 검색 수행
     */
    async searchDiaries(query, entries) {
        if (!this.isReady()) {
            throw new Error('Gemini API 키가 설정되지 않았습니다.');
        }

        // 일기 데이터를 텍스트로 변환 (최근 50개만 사용 - 토큰 제한 고려)
        const entriesText = entries.slice(0, 50).map(e =>
            `ID: ${e.id}\nDate: ${e.date}\nContent: ${e.content}\nComment: ${e.dailyComment}`
        ).join('\n---\n');

        const prompt = `
        사용자가 다음 질문을 했습니다: "${query}"
        
        아래는 사용자의 일기 목록입니다:
        ---
        ${entriesText}
        ---
        
        주의: 일기 내용 중에 [[YYYY-MM-DD]] 형식으로 된 부분은 다른 날짜의 일기를 참조(링크)한다는 의미입니다. 
        사용자의 질문에 답변을 찾을 때, 이 참조 관계를 고려하여 연관된 일기맥락도 함께 파악해주세요.
        
        이 일기들 중에서 질문과 가장 관련이 깊은 일기들을 찾아서 JSON 형식으로 반환해주세요.
        형식:
        {
            "summary": "질문에 대한 간단한 요약 답변 (참조된 일기 내용이 있다면 어떻게 연결되는지 포함해서 설명)",
            "results": [
                {
                    "id": "일기 ID (YYYY-MM-DD)",
                    "reason": "이 일기를 선택한 이유"
                }
            ]
        }
        
        관련된 일기가 없다면 summary에 이유를 적고 results는 빈 배열로 반환하세요.
        JSON만 반환하고 다른 텍스트는 포함하지 마세요.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // JSON 파싱 (마크다운 코드 블록 제거)
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error('AI Search failed:', error);
            throw new Error('AI 검색 중 오류가 발생했습니다.');
        }
    }

    /**
     * 일기 내용에 대한 코멘트/제안 생성
     */
    async getSuggestions(content, recentEntries) {
        if (!this.isReady()) {
            throw new Error('Gemini API 키가 설정되지 않았습니다.');
        }

        // 최근 3일간의 일기 문맥 추가
        const contextEntries = recentEntries.slice(0, 3).map(e => e.content).join('\n');

        const prompt = `
        사용자가 오늘 일기를 작성 중입니다:
        "${content}"
        
        최근 일기 문맥 (참고용):
        ${contextEntries}
        
        주의사항:
        1. 작성 중인 일기 내용에 [[YYYY-MM-DD]] 형식이 있다면, 이는 과거의 특정 일기를 참조(회고)하고 있다는 뜻입니다.
        2. 만약 과거 일기가 참조되었다면, 과거의 사건과 현재의 감정을 연결짓는 의미 있는 질문이나 격려를 제안해주세요.
        3. 참조가 없다면, 현재 작성된 내용에 공감하거나 더 깊이 생각해볼 만한 질문을 제안해주세요.
        
        위 내용을 바탕으로 사용자에게 도움이 될 만한 3가지의 간단한 코멘트나 질문을 제안해주세요.
        각 제안은 줄바꿈으로 구분해주세요.
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('AI Suggestion failed:', error);
            throw new Error('AI 제안 생성 실패');
        }
    }
}

export const gemini = new GeminiAI();

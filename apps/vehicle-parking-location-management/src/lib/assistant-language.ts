export const assistantLanguages = {
  en: {
    name: 'English',
    label: 'Reply language',
    prompt: 'Enter a prompt or function shortcut…',
  },
  hi: {
    name: 'हिन्दी',
    label: 'उत्तर की भाषा',
    prompt: 'अपना सवाल या शॉर्टकट लिखें…',
  },
  si: {
    name: 'සිංහල',
    label: 'පිළිතුරු භාෂාව',
    prompt: 'ඔබේ ප්‍රශ්නය හෝ කෙටි විධානය ඇතුළත් කරන්න…',
  },
  ta: {
    name: 'தமிழ்',
    label: 'பதில் மொழி',
    prompt: 'உங்கள் கேள்வி அல்லது குறுக்குக் கட்டளையை உள்ளிடுங்கள்…',
  },
} as const;

export type AssistantLanguage = keyof typeof assistantLanguages;

export function isAssistantLanguage(value: unknown): value is AssistantLanguage {
  return typeof value === 'string' && Object.hasOwn(assistantLanguages, value);
}

export function readAssistantLanguage(key: string): AssistantLanguage {
  try {
    const value = window.localStorage.getItem(key);
    if (isAssistantLanguage(value)) return value;
  } catch {
    // The selector still works for the current session if storage is unavailable.
  }
  return 'en';
}

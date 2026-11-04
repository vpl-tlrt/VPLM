const names = {
  en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', si: 'සිංහල', bn: 'বাংলা',
} as const;

export type AssistantLanguage = keyof typeof names;
export const assistantLanguages = names;

type DisplayText = {
  display: string; reply: string; prompt: string; subtitle: string; help: string; close: string;
  send: string; thinking: string; yes: string; no: string; destination: string; selectBay: string;
  confirm: string; cancel: string; taking: string; where: string; unavailable: string;
};

export const assistantDisplay: Record<AssistantLanguage, DisplayText> = {
  en: {
    display: 'Display language', reply: 'Reply language', prompt: 'Enter a question or shortcut…', subtitle: 'Workspace functions · Gemini AI',
    help: 'Show function directory', close: 'Close AI assistant', send: 'Send message', thinking: 'Thinking…', yes: 'Yes', no: 'No',
    destination: 'Available destination space', selectBay: 'Select a bay', confirm: 'Confirm destination', cancel: 'Cancel transfer',
    taking: 'Are you taking it?', where: 'Where are you planning to park it? Choose a bay or type its label, such as B47, W01 or A46X.',
    unavailable: 'That space is unavailable. Choose another available bay.',
  },
  hi: {
    display: 'इंटरफ़ेस की भाषा', reply: 'उत्तर की भाषा', prompt: 'सवाल या शॉर्टकट लिखें…', subtitle: 'कार्यस्थल की सुविधाएँ · Gemini AI',
    help: 'सुविधाओं की सूची दिखाएँ', close: 'AI सहायक बंद करें', send: 'संदेश भेजें', thinking: 'सोच रहा है…', yes: 'हाँ', no: 'नहीं',
    destination: 'उपलब्ध पार्किंग स्थान', selectBay: 'पार्किंग स्थान चुनें', confirm: 'स्थान की पुष्टि करें', cancel: 'स्थानांतरण रद्द करें',
    taking: 'क्या आप वाहन ले जा रहे हैं?', where: 'वाहन कहाँ पार्क करेंगे? कोई स्थान चुनें या उसका कोड लिखें, जैसे B47, W01 या A46X।',
    unavailable: 'यह स्थान उपलब्ध नहीं है। कोई दूसरा उपलब्ध स्थान चुनें।',
  },
  ta: {
    display: 'திரை மொழி', reply: 'பதில் மொழி', prompt: 'கேள்வி அல்லது குறுக்குக் கட்டளையை உள்ளிடுங்கள்…', subtitle: 'பணியிடச் செயல்பாடுகள் · Gemini AI',
    help: 'செயல்பாட்டுப் பட்டியலைக் காட்டு', close: 'AI உதவியாளரை மூடு', send: 'செய்தியை அனுப்பு', thinking: 'சிந்திக்கிறது…', yes: 'ஆம்', no: 'இல்லை',
    destination: 'கிடைக்கும் நிறுத்துமிடம்', selectBay: 'நிறுத்துமிடத்தைத் தேர்ந்தெடுக்கவும்', confirm: 'இடத்தை உறுதிசெய்', cancel: 'இடமாற்றத்தை ரத்துசெய்',
    taking: 'வாகனத்தை எடுத்துச் செல்கிறீர்களா?', where: 'வாகனத்தை எங்கு நிறுத்தப் போகிறீர்கள்? இடத்தைத் தேர்ந்தெடுக்கவும் அல்லது B47, W01, A46X போன்ற குறியீட்டை உள்ளிடவும்.',
    unavailable: 'இந்த இடம் கிடைக்கவில்லை. கிடைக்கும் வேறொரு இடத்தைத் தேர்ந்தெடுக்கவும்.',
  },
  si: {
    display: 'දර්ශන භාෂාව', reply: 'පිළිතුරු භාෂාව', prompt: 'ප්‍රශ්නයක් හෝ කෙටි විධානයක් ඇතුළත් කරන්න…', subtitle: 'වැඩබිම් කාර්යයන් · Gemini AI',
    help: 'කාර්ය ලැයිස්තුව පෙන්වන්න', close: 'AI සහායකය වසන්න', send: 'පණිවිඩය යවන්න', thinking: 'සිතමින්…', yes: 'ඔව්', no: 'නැහැ',
    destination: 'ලබා ගත හැකි නැවතුම් ස්ථානය', selectBay: 'නැවතුම් ස්ථානයක් තෝරන්න', confirm: 'ස්ථානය තහවුරු කරන්න', cancel: 'මාරුව අවලංගු කරන්න',
    taking: 'ඔබ වාහනය රැගෙන යනවාද?', where: 'වාහනය නවත්වන්නේ කොහේද? ස්ථානයක් තෝරන්න හෝ B47, W01, A46X වැනි කේතයක් ඇතුළත් කරන්න.',
    unavailable: 'මෙම ස්ථානය ලබා ගත නොහැක. වෙනත් ලබා ගත හැකි ස්ථානයක් තෝරන්න.',
  },
  bn: {
    display: 'ইন্টারফেসের ভাষা', reply: 'উত্তরের ভাষা', prompt: 'প্রশ্ন বা শর্টকাট লিখুন…', subtitle: 'কর্মক্ষেত্রের সুবিধা · Gemini AI',
    help: 'সুবিধার তালিকা দেখান', close: 'AI সহকারী বন্ধ করুন', send: 'বার্তা পাঠান', thinking: 'ভাবছে…', yes: 'হ্যাঁ', no: 'না',
    destination: 'খালি পার্কিং স্থান', selectBay: 'একটি পার্কিং স্থান বেছে নিন', confirm: 'স্থান নিশ্চিত করুন', cancel: 'স্থানান্তর বাতিল করুন',
    taking: 'আপনি কি গাড়িটি নিয়ে যাচ্ছেন?', where: 'গাড়িটি কোথায় পার্ক করবেন? একটি স্থান বেছে নিন অথবা B47, W01 বা A46X-এর মতো কোড লিখুন।',
    unavailable: 'এই স্থানটি খালি নেই। অন্য একটি খালি স্থান বেছে নিন।',
  },
};

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

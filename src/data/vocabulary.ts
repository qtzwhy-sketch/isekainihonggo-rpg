export type VocabularyItem = {
    id: number;
    word: string;
    reading: string;
    meaning: string;
    /** 例句（可选，用于错题学习反馈） */
    example?: string;
    level: "N1" | "N2" | "N3" | "N4" | "N5";
  };
  
  export const vocabulary: VocabularyItem[] = [
    {
      id: 1,
      word: "崩す",
      reading: "くずす",
      meaning: "使崩溃；打乱",
      example: "計画を崩す。",
      level: "N1",
    },
    {
      id: 2,
      word: "剥がす",
      reading: "はがす",
      meaning: "剥下；揭下",
      level: "N1",
    },
    {
      id: 3,
      word: "察する",
      reading: "さっする",
      meaning: "推测；体察",
      example: "相手の気持ちを察する。",
      level: "N1",
    },
    {
      id: 4,
      word: "促す",
      reading: "うながす",
      meaning: "催促；促进",
      level: "N1",
    },
    {
      id: 5,
      word: "果たす",
      reading: "はたす",
      meaning: "完成；实现",
      level: "N1",
    },
    {
      id: 6,
      word: "壊す",
      reading: "こわす",
      meaning: "破坏；弄坏",
      level: "N1",
    },
    {
      id: 7,
      word: "騙す",
      reading: "だます",
      meaning: "欺骗",
      example: "人を騙すのはよくない。",
      level: "N1",
    },
    {
      id: 8,
      word: "癒す",
      reading: "いやす",
      meaning: "治愈",
      level: "N1",
    },
    {
      id: 9,
      word: "正す",
      reading: "ただす",
      meaning: "纠正；改正",
      level: "N1",
    },
    {
      id: 10,
      word: "揺るがす",
      reading: "ゆるがす",
      meaning: "动摇；震动",
      level: "N1",
    },
  ];
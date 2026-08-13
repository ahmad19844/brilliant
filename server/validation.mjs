export function validateQuestion({text,options,correctOption}) { if(!text?.trim()||!Array.isArray(options)||options.length!==4||options.some(x=>!String(x).trim())||!['A','B','C','D'].includes(correctOption)) throw new Error('A question requires text, four options and one correct option'); return true; }
export const validGender = g => ['Male','Female'].includes(g);

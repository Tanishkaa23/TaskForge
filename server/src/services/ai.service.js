import Groq from "groq-sdk";
import "dotenv/config";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const summarizeText = async (text) => {
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "Summarize the provided text clearly. Include the key points and avoid adding information not present in the text.",
      },
      {
        role: "user",
        content: text,
      },
    ],
    temperature: 0.3,
  });

  return completion.choices[0].message.content;
};
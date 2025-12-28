
import { GoogleGenAI, Type } from "@google/genai";
import { HTTPMethod } from "../types";

export const generateAPIFromPrompt = async (prompt: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following API requirement and generate a comprehensive JSON object matching an 'api_specs' database schema for a Model Context Protocol (MCP) server.
    Requirement: "${prompt}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Lower_snake_case name for the tool" },
          method: { type: Type.STRING, enum: Object.values(HTTPMethod), description: "HTTP Method" },
          url: { type: Type.STRING, description: "Full URL if applicable" },
          base_url: { type: Type.STRING, description: "Base URL part" },
          path: { type: Type.STRING, description: "Relative path with placeholders like {id}" },
          description: { type: Type.STRING, description: "Clear description of what the tool does" },
          default_headers: { type: Type.OBJECT, description: "Default headers object" },
          default_json: { type: Type.OBJECT, description: "Default body object if applicable" },
          timeout_s: { type: Type.NUMBER, description: "Default timeout in seconds" }
        },
        required: ["name", "method", "description"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text);
    return data;
  } catch (error) {
    console.error("Failed to parse Gemini response", error);
    throw error;
  }
};

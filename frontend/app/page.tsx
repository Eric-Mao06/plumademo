'use client';

import React, { useEffect, useState } from "react";
import { RetellWebClient } from "retell-client-js-sdk";
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import OpenAI from 'openai';
import ReactMarkdown from 'react-markdown';
import jsPDF from 'jspdf';

const agentId = "agent_8ffe11ae048b9c67b50cedb45d";

interface RegisterCallResponse {
  call_id?: string;
  sample_rate: number;
}

interface Utterance {
  role: 'agent' | 'user';
  content: string;
}

const webClient = new RetellWebClient();

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

export default function Home() {
  const [isCalling, setIsCalling] = useState(false);
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);
  const [transcriptInput, setTranscriptInput] = useState("");
  const [report, setReport] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    webClient.on("conversationStarted", () => {
      console.log("conversationStarted");
      setTranscript([]);
    });

    webClient.on("conversationEnded", async ({ code, reason }) => {
      console.log("Closed with code:", code, ", reason:", reason);
      setIsCalling(false);
    });

    webClient.on("error", (error) => {
      console.error("An error occurred:", error);
      setIsCalling(false);
    });

    webClient.on("transcriptUpdated", (utterance) => {
      console.log("Received utterance:", utterance);
      const formattedUtterance: Utterance = {
        role: utterance.role === 'assistant' ? 'agent' : 'user',
        content: utterance.content
      };
      console.log("Formatted utterance:", formattedUtterance);
      setTranscript(prev => {
        console.log("Previous transcript:", prev);
        const newTranscript = [...prev, formattedUtterance];
        console.log("New transcript:", newTranscript);
        return newTranscript;
      });
    });
  }, [currentCallId]);

  const toggleConversation = async () => {
    if (isCalling) {
      webClient.stopConversation();
      setIsCalling(false);
    } else {
      try {
        const registerCallResponse = await registerCall(agentId);
        console.log("Register call response:", registerCallResponse);
        if (!registerCallResponse.call_id) {
          throw new Error("No call_id received");
        }
        
        setCurrentCallId(registerCallResponse.call_id);
        
        await webClient.startConversation({
          callId: registerCallResponse.call_id,
          sampleRate: registerCallResponse.sample_rate,
          enableUpdate: true,
        });
        setIsCalling(true);
      } catch (error) {
        console.error("Failed to start conversation:", error);
        setIsCalling(false);
      }
    }
  };

  async function registerCall(agent_id_path: string): Promise<RegisterCallResponse> {
    try {
      const response = await fetch(
        "http://localhost:8080/register-call-on-your-server",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          }
        },
      );

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data: RegisterCallResponse = await response.json();
      return data;
    } catch (err) {
      console.log(err);
      throw new Error(err as string);
    }
  }

  const generateReport = async () => {
    if (!transcriptInput.trim()) return;
    
    setIsGenerating(true);
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a medical conversation analyzer. Analyze the conversation between a medical assistant and a patient and provide a detailed analysis addressing these areas:
    
  Initial Assessment:
  1. How the patient is feeling after taking their medication
  2. Any discomfort or unusual sensations reported
  3. Changes in physical condition
  
  Follow-up Assessment:
  1. Patient's current mood
  2. Any difficulties with daily activities
  3. Patient concerns or worries
  
  Final Notes:
  1. Any requests for assistance or support
  
  Please provide a natural, flowing analysis that addresses each of these points in a clear, readable format. Do not include a summary at the end.`
          },
          {
            role: "user",
            content: `Please create a brief report from this call transcript, at the top list two lines the first should be 'Patient Name: Aidan Guo' the second should be 'Medication: 80mg Vyvanse': \n\n${transcriptInput}`
          }
        ],
        temperature: 0.7,
      });

      const reportText = completion.choices[0].message.content || "";
      setReport(reportText);

      // Generate PDF
      const pdf = new jsPDF();
      
      // Add title
      pdf.setFontSize(16);
      pdf.text('Medical Conversation Report', 20, 20);
      
      // Add content with word wrap
      pdf.setFontSize(12);
      const splitText = pdf.splitTextToSize(reportText, 170); // 170 is the max width
      pdf.text(splitText, 20, 40);

      // Save the PDF
      pdf.save('medical-report.pdf');

    } catch (error) {
      console.error("Failed to generate report:", error);
      setReport("Error generating report. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="flex min-h-screen">
      {/* Left half - Controls */}
      <div className="flex-1 flex flex-col items-center justify-center p-24">
        <Button 
          onClick={toggleConversation}
          variant={isCalling ? "destructive" : "default"}
          size="lg"
        >
          {isCalling ? "End Conversation" : "Start Conversation"}
        </Button>
      </div>

      {/* Right half - Transcript */}
      <div className="flex-1 border-l border-gray-200 p-8 h-screen">
        <ScrollArea className="h-full">
          <Card>
            <CardHeader>
              <CardTitle>Call Report Generator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Paste call transcript here..."
                className="min-h-[300px]"
                value={transcriptInput}
                onChange={(e) => setTranscriptInput(e.target.value)}
              />
              <Button 
                onClick={generateReport}
                className="w-full"
                disabled={isGenerating || !transcriptInput.trim()}
              >
                {isGenerating ? "Generating..." : "Generate Report"}
              </Button>
              {report && (
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle>Generated Report</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ReactMarkdown className="prose dark:prose-invert">
                      {report}
                    </ReactMarkdown>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </ScrollArea>
      </div>
    </main>
  );
}
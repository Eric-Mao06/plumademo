import json
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.websockets import WebSocketState
from fastapi.middleware.cors import CORSMiddleware
# from llm import LlmClient
from llm_with_func_calling import LlmClient
# from twilio_server import TwilioClient  # Comment this out
from retellclient.models import operations
from twilio.twiml.voice_response import VoiceResponse
import retellclient
from retellclient.models import operations, components
import asyncio
import time

load_dotenv(override=True)

app = FastAPI()

# Allow requests from all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
retell = retellclient.RetellClient(
    api_key=os.environ['RETELL_API_KEY'],
)

# twilio_client.create_phone_number(213, os.environ['RETELL_AGENT_ID'])
# twilio_client.delete_phone_number("+12133548310")
# twilio_client.register_phone_agent("+14154750418", os.environ['RETELL_AGENT_ID'])
# twilio_client.create_phone_call("+12138982019", "+19367304543", os.environ['RETELL_AGENT_ID'])

# Add this near the top of your file, after the imports
call_summaries = {}

@app.post("/register-call-on-your-server")
async def register_call_on_your_server(request: Request):
    try:
        call_response = retell.register_call(operations.RegisterCallRequestBody(
            agent_id=os.environ['RETELL_AGENT_ID'],
            audio_websocket_protocol='web',
            audio_encoding='s16le',
            sample_rate=24000
        ))
        if call_response.status_code == 201:
            print(call_response.status_code)
            print(call_response.call_detail.__dict__)
            return JSONResponse(call_response.call_detail.__dict__)
    except Exception as err:
        print(f"Error in twilio voice webhook: {err}")
        return JSONResponse(status_code=500, content={"message": "Internal Server Error"})

@app.websocket("/llm-websocket/{call_id}")
async def websocket_handler(websocket: WebSocket, call_id: str):
    await websocket.accept()
    print(f"Handle llm ws for: {call_id}")

    llm_client = LlmClient()
    transcript = []  # Add this to store the transcript

    # Add this to store the start timestamp
    start_timestamp = time.time() * 1000  # Convert to milliseconds

    # send first message to signal ready of server
    response_id = 0
    first_event = llm_client.draft_begin_messsage()
    await websocket.send_text(json.dumps(first_event))

    async def stream_response(request):
        nonlocal response_id
        for event in llm_client.draft_response(request):
            await websocket.send_text(json.dumps(event))
            if request['response_id'] < response_id:
                return # new response needed, abondon this one
    try:
        while True:
            message = await websocket.receive_text()
            request = json.loads(message)
            # print out transcript
            os.system('cls' if os.name == 'nt' else 'clear')
            print(json.dumps(request, indent=4))
            
            if 'response_id' not in request:
                continue # no response needed, process live transcript update if needed
            response_id = request['response_id']
            asyncio.create_task(stream_response(request))

            # Update transcript
            if 'transcript' in request:
                transcript = request['transcript']
    except WebSocketDisconnect:
        # Store the call summary when the conversation ends
        end_timestamp = time.time() * 1000
        call_summaries[call_id] = {
            "transcript": "\n".join([f"{u['role']}: {u['content']}" for u in transcript]),
            "transcript_object": transcript,
            "start_timestamp": start_timestamp,
            "end_timestamp": end_timestamp
        }
        print(f"LLM WebSocket disconnected for {call_id}")
    except Exception as e:
        print(f'LLM WebSocket error for {call_id}: {e}')
    finally:
        print(f"LLM WebSocket connection closed for {call_id}")

@app.post("/webhook")
async def handle_webhook(request: Request):
    try:
        body = await request.json()
        signature = request.headers.get("x-retell-signature")
        
        if not retellclient.Retell.verify(
            json.dumps(body),
            os.environ['RETELL_API_KEY'],
            signature
        ):
            return JSONResponse(status_code=400, content={"message": "Invalid signature"})
        
        event = body.get("event")
        call = body.get("call")
        
        if event == "call_ended":
            # Store the call summary in memory (you might want to use a proper database)
            call_summaries[call["call_id"]] = {
                "transcript": call["transcript"],
                "transcript_object": call["transcript_object"],
                "start_timestamp": call["start_timestamp"],
                "end_timestamp": call["end_timestamp"]
            }
            
        return JSONResponse(status_code=204)
    except Exception as err:
        print(f"Error in webhook handler: {err}")
        return JSONResponse(status_code=500, content={"message": "Internal Server Error"})

@app.get("/call-summary/{call_id}")
async def get_call_summary(call_id: str):
    if call_id in call_summaries:
        return call_summaries[call_id]
    return JSONResponse(status_code=404, content={"error": "Call summary not found"})
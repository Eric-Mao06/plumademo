1. First install dependencies

```bash
pip3 install -r requirements.txt
```

2. Fill out the API keys in `.env`

3. Start the websocket server

```bash
uvicorn server:app --reload --port=8080
```
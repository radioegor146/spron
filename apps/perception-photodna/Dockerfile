FROM debian:13
RUN apt update && apt install -y wine wget unzip
WORKDIR /app
RUN wget https://releases.astral.sh/github/uv/releases/download/0.6.17/uv-x86_64-pc-windows-msvc.zip -O uv.zip
RUN unzip uv.zip
RUN wine uv python install 
COPY requirements.txt requirements.txt
RUN wine -- cmd.exe /c ".venv\\Sciprts\\activate && uv pip install -r requirements.txt"
COPY . . 
CMD ["wine", "--", "cmd.exe /c \".venv\\Sciprts\\activate && python main.py\""]
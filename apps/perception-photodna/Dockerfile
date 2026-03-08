FROM debian:13
RUN apt update && apt install -y wine wget unzip
WORKDIR /app
RUN wget https://releases.astral.sh/github/uv/releases/download/0.6.17/uv-x86_64-pc-windows-msvc.zip -O uv.zip
RUN unzip uv.zip
RUN wine uv python install 
COPY requirements.txt requirements.txt
COPY install.bat install.bat
RUN wine install.bat
COPY . . 
CMD ["wine", "run.bat"]
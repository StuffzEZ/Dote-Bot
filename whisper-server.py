import os
import tempfile
from flask import Flask, request, jsonify
from flask_cors import CORS
from faster_whisper import WhisperModel

app = Flask(__name__)
CORS(app)

model_name = os.environ.get('ASR_MODEL', 'base')
print(f'Loading Whisper model: {model_name}...')
model = WhisperModel(model_name, device='cpu', compute_type='int8')
print(f'Whisper model loaded: {model_name}')

@app.route('/asr', methods=['POST'])
def transcribe():
    if 'audio_file' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio_file']
    language = request.args.get('language') or request.form.get('language')

    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        audio_file.save(tmp.name)
        try:
            kwargs = {}
            if language:
                kwargs['language'] = language

            segments, info = model.transcribe(tmp.name, **kwargs)
            text = ' '.join([segment.text for segment in segments])
            return jsonify({'text': text.strip()})
        finally:
            os.unlink(tmp.name)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model': model_name})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=9000)

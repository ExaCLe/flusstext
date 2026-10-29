"""Build the Windows/ONNX speech-only variant; no NeMo or LLM is required.

Architecture adapted from NVIDIA NeMo Speech (Apache-2.0), commit
16b0ff2584c6355c53cbd6c28f0f431a76b24956: transformer_encoder.py,
multi_head_attention.py and ctc_timestamp_utils.py. NVIDIA weights retain
their OpenMDW-1.1 license. See the licenses distributed with the export.

Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES.
SPDX-License-Identifier: Apache-2.0
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
from pathlib import Path

os.environ['ORT_DISABLE_TELEMETRY'] = '1'

SOURCE_REVISION = '9d8cd6b79bfdd427b6558a5fdbf76fcaf8c75341'
SOURCE = f'https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B/resolve/{SOURCE_REVISION}'
PREFIXES = ('perception.encoder.asr_encoder.', 'perception.preprocessor.', 'ctc_timestamp.decoder.')


def extract(root: Path):
    import requests
    ckpt = root / 'lite.safetensors'
    if ckpt.exists():
        if not (root/'source-config.json').exists():
            response = requests.get(SOURCE + '/config.json', timeout=30)
            response.raise_for_status()
            (root/'source-config.json').write_bytes(response.content)
        return

    def fetch(a, b):
        with requests.get(SOURCE + '/model.safetensors', headers={'Range': f'bytes={a}-{b}'},
                          stream=True, timeout=(30, 180)) as response:
            expected = f'bytes {a}-{b}/'
            if response.status_code != 206 or not response.headers.get('Content-Range', '').startswith(expected):
                raise RuntimeError('Server did not honor the bounded range; refusing a full-model download')
            data = response.raw.read(b-a+2)
            if len(data) != b-a+1:
                raise RuntimeError('Incomplete checkpoint range')
            return data

    n = struct.unpack('<Q', fetch(0, 7))[0]
    if n > 20_000_000:
        raise RuntimeError('Unexpected checkpoint index size')
    header = json.loads(fetch(8, 7+n))
    names = sorted((k for k in header if k.startswith(PREFIXES)), key=lambda k: header[k]['data_offsets'][0])
    new = {'__metadata__': header.get('__metadata__', {})}
    spans, offset = [], 0
    for key in names:
        value = header[key]
        start, end = value['data_offsets']
        new[key] = {**value, 'data_offsets': [offset, offset+end-start]}
        offset += end-start
        if spans and spans[-1][1] == start:
            spans[-1][1] = end
        else:
            spans.append([start, end])
    index = json.dumps(new, separators=(',', ':')).encode()
    index += b' ' * (-len(index) % 8)
    print(f'Extracting {len(names)} speech tensors ({offset / 1e9:.2f} GB), excluding the LLM', flush=True)
    part = ckpt.with_suffix('.part')
    done = 0
    with part.open('wb') as dest:
        dest.write(struct.pack('<Q', len(index)) + index)
        for start, end in spans:
            for pos in range(start, end, 64 << 20):
                stop = min(pos+(64 << 20), end)
                dest.write(fetch(8+n+pos, 8+n+stop-1))
                done += stop-pos
                print(f'  {done / 1e9:.2f} / {offset / 1e9:.2f} GB', flush=True)
    part.replace(ckpt)
    response = requests.get(SOURCE + '/config.json', timeout=30)
    response.raise_for_status()
    (root/'source-config.json').write_bytes(response.content)


def build_modules(root: Path):
    import torch
    from torch import nn
    from torch.nn import functional as F
    from safetensors import safe_open

    class Transformer(nn.Module):
        def __init__(self, prefix, cfg):
            super().__init__()
            self.cfg = cfg
            self.weights = nn.ParameterDict()
            with safe_open(root/'lite.safetensors', framework='pt') as source:
                for key in source.keys():
                    if key.startswith(prefix):
                        name = key[len(prefix):].replace('.', '_')
                        self.weights[name] = nn.Parameter(source.get_tensor(key).float(), requires_grad=False)
            d = cfg['d_model'] // cfg['n_heads']
            self.rot = int(d * cfg['rotary_fraction'])
            freqs = torch.outer(torch.arange(5000).float(), 1 / (cfg['rope_base'] ** (torch.arange(0, self.rot, 2).float()/self.rot)))
            angles = torch.cat([freqs, freqs], -1)
            self.register_buffer('cos', angles.cos()[None, None])
            self.register_buffer('sin', angles.sin()[None, None])

        def w(self, name):
            return self.weights[name.replace('.', '_')]

        def linear(self, x, name):
            key = name.replace('.', '_')
            return F.linear(x, self.weights[key+'_weight'], self.weights[key+'_bias'] if key+'_bias' in self.weights else None)

        def norm(self, x, name):
            return F.layer_norm(x, [self.w(name+'.weight').numel()], self.w(name+'.weight'), self.w(name+'.bias'))

        def rotate(self, x):
            a, b = x[..., :self.rot], x[..., self.rot:]
            half = self.rot // 2
            rotated = torch.cat([-a[..., half:], a[..., :half]], -1)
            return torch.cat([a*self.cos[:, :, :x.shape[2]] + rotated*self.sin[:, :, :x.shape[2]], b], -1)

        def forward(self, x, length):
            x = self.norm(x, 'embed_norm')
            B, T, _ = x.shape
            H, D = self.cfg['n_heads'], self.cfg['d_model']//self.cfg['n_heads']
            bias = (torch.arange(T, device=x.device)[None] >= length[:, None]).to(x.dtype)[:, None, None] * -30000
            for i in range(self.cfg['n_layers']):
                p = f'layers.{i}.'
                y = self.norm(x, p+'norm1')
                q, k, v = self.linear(y, p+'attn.w_qkv').reshape(B, T, 3, H, D).permute(2, 0, 3, 1, 4).unbind(0)
                q = self.rotate(self.norm(q, p+'attn.q_norm'))
                k = self.rotate(self.norm(k, p+'attn.k_norm'))
                y = torch.softmax((q @ k.transpose(-2, -1)) * (D**-0.5) + bias, -1) @ v
                x = x + self.linear(y.transpose(1, 2).reshape(B, T, self.cfg['d_model']), p+'attn.out_proj')
                y = self.linear(self.norm(x, p+'norm2'), p+'ffn.net.0')
                x = x + self.linear(F.gelu(y), p+'ffn.net.3')
            return self.norm(x, 'final_norm').transpose(1, 2)

    cfg = json.loads((root/'source-config.json').read_text(encoding='utf8'))['pe_encoder_config']['asr_encoder_cfg']
    with safe_open(root/'lite.safetensors', framework='pt') as source:
        head_cfg = json.loads(source.metadata()['ctc_timestamp_decoder_config'])
        vocab = head_cfg.pop('vocabulary')
        assets = root/'onnx'
        assets.mkdir(exist_ok=True)
        (assets/'vocab.json').write_text(json.dumps(vocab, ensure_ascii=False), encoding='utf8')
        for key, name in [('fb', 'mel-filterbank.bin'), ('window', 'mel-window.bin')]:
            source.get_tensor('perception.preprocessor.featurizer.'+key).float().numpy().tofile(assets/name)

    class Encoder(Transformer):
        def __init__(self):
            super().__init__('perception.encoder.asr_encoder.', cfg)

        def forward(self, mel, enc_len):
            x = self.linear(mel.transpose(1, 2).reshape(1, -1, 128*8), 'pre_encode.proj')
            return super().forward(x, enc_len)

    class Head(Transformer):
        def __init__(self):
            head = {**head_cfg, 'd_model': head_cfg['feat_in']}
            super().__init__('ctc_timestamp.decoder.transformer.', head)
            with safe_open(root/'lite.safetensors', framework='pt') as source:
                for key in ['upsample.weight', 'upsample.bias', 'decoder_layers.0.weight', 'decoder_layers.0.bias', 'residual_scale']:
                    self.weights['ctc_'+key.replace('.', '_')] = nn.Parameter(source.get_tensor('ctc_timestamp.decoder.'+key).float(), requires_grad=False)

        def forward(self, states, enc_len):
            up = F.conv_transpose1d(states, self.weights['ctc_upsample_weight'], self.weights['ctc_upsample_bias'], stride=2)
            bridge = super().forward(up.transpose(1, 2), enc_len*2)
            h = up + self.weights['ctc_residual_scale'] * bridge
            # A linear projection permits ONNX's dynamic MatMul quantization.
            logits = F.linear(h.transpose(1, 2), self.weights['ctc_decoder_layers_0_weight'][:, :, 0], self.weights['ctc_decoder_layers_0_bias'])
            return torch.argmax(logits, dim=-1).to(torch.int32)

    return Encoder().eval(), Head().eval()


def export(root: Path):
    import torch
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic
    ort.disable_telemetry_events()
    torch.set_num_threads(4)
    encoder, head = build_modules(root)
    dest = root/'onnx'
    for name, module, sample, inputs, outputs, axes in [
        ('encoder', encoder, (torch.zeros(1, 128, 800), torch.tensor([100])), ['mel', 'enc_len'], ['states'], {'mel': {2: 'mel_frames'}, 'states': {2: 'encoder_frames'}}),
        ('ctc', head, (torch.zeros(1, 1280, 100), torch.tensor([100])), ['states', 'enc_len'], ['token_ids'], {'states': {2: 'encoder_frames'}, 'token_ids': {1: 'ctc_frames'}})
    ]:
        fp32 = dest/f'{name}.fp32.onnx'
        if not fp32.exists():
            print('Exporting', name, flush=True)
            torch.onnx.export(module, sample, str(fp32), input_names=inputs, output_names=outputs, dynamic_axes=axes,
                              opset_version=17, do_constant_folding=True, dynamo=False)
        quant = dest/f'{name}.int8.onnx'
        if not quant.exists():
            print('Quantizing', name, flush=True)
            quantize_dynamic(str(fp32), str(quant), weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=['MatMul', 'Gemm'])
    manifest = {'source': SOURCE, 'variant': 'speech-encoder-ctc-only', 'sampleRate': 16000,
                'melBins': 128, 'blankId': 23862, 'ctcFrameSeconds': 0.04, 'experimental': True, 'evaluatedLanguages': ['en']}
    (dest/'config.json').write_text(json.dumps(manifest, indent=2)+'\n')
    import requests
    for remote, name in [(SOURCE+'/LICENSE', 'LICENSE-OpenMDW.txt'),
                         (SOURCE+'/THIRD_PARTY_NOTICES.md', 'NOTICE-NVIDIA.txt'),
                         ('https://raw.githubusercontent.com/NVIDIA-NeMo/Speech/16b0ff2584c6355c53cbd6c28f0f431a76b24956/LICENSE', 'LICENSE-NeMo.txt')]:
        response = requests.get(remote, timeout=30)
        response.raise_for_status()
        (dest/name).write_bytes(response.content)
    artifacts = {'encoder.int8.onnx', 'ctc.int8.onnx', 'config.json', 'vocab.json', 'mel-window.bin', 'mel-filterbank.bin',
                 'LICENSE-OpenMDW.txt', 'LICENSE-NeMo.txt', 'NOTICE-NVIDIA.txt'}
    for file in sorted(dest.glob('*')):
        if file.name in artifacts:
            print(file.name, file.stat().st_size, hashlib.file_digest(file.open('rb'), 'sha256').hexdigest(), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--extract-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    extract(args.output)
    if not args.extract_only:
        export(args.output)

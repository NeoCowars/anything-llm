import json
from pathlib import Path
import onnx
from onnx import helper, TensorProto

root = Path(__file__).resolve().parent
vocab = {word: i for i, word in enumerate(['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]', '本', '地', '模', '型', '测', '试', '员', '工', '交', '通', '补', '贴', '无', '有', '正', '式', '期', '用', '？', '。', 'a', 'b'])}
tokenizer = {
 'version': '1.0', 'truncation': None, 'padding': None,
 'added_tokens': [{'id': vocab[t], 'content': t, 'single_word': False, 'lstrip': False, 'rstrip': False, 'normalized': False, 'special': True} for t in list(vocab)[:5]],
 'normalizer': {'type':'BertNormalizer', 'clean_text':True, 'handle_chinese_chars':True, 'strip_accents':None, 'lowercase':True},
 'pre_tokenizer': {'type':'BertPreTokenizer'},
 'post_processor': {'type':'TemplateProcessing', 'single':[{'SpecialToken':{'id':'[CLS]', 'type_id':0}},{'Sequence':{'id':'A','type_id':0}},{'SpecialToken':{'id':'[SEP]','type_id':0}}],
 'pair':[{'SpecialToken':{'id':'[CLS]','type_id':0}},{'Sequence':{'id':'A','type_id':0}},{'SpecialToken':{'id':'[SEP]','type_id':0}},{'Sequence':{'id':'B','type_id':1}},{'SpecialToken':{'id':'[SEP]','type_id':1}}],
 'special_tokens': {t:{'id':t, 'ids':[vocab[t]], 'tokens':[t]} for t in ['[CLS]','[SEP]']}},
 'decoder': {'type':'WordPiece', 'prefix':'##', 'cleanup':True},
 'model': {'type':'WordPiece', 'unk_token':'[UNK]', 'continuing_subword_prefix':'##', 'max_input_chars_per_word':100, 'vocab':vocab}}
for kind in ['embedding', 'reranker']:
 folder=root/kind
 (folder/'onnx').mkdir(parents=True,exist_ok=True)
 config={'model_type':'bert','architectures':['BertModel' if kind=='embedding' else 'BertForSequenceClassification'], 'hidden_size':4, 'num_labels':1,'id2label':{'0':'SCORE'}}
 (folder/'config.json').write_text(json.dumps(config),encoding='utf8')
 (folder/'tokenizer.json').write_text(json.dumps(tokenizer),encoding='utf8')
 (folder/'tokenizer_config.json').write_text(json.dumps({'tokenizer_class':'BertTokenizer','model_max_length':64,'pad_token':'[PAD]','unk_token':'[UNK]','cls_token':'[CLS]','sep_token':'[SEP]','mask_token':'[MASK]'}),encoding='utf8')
 inputs=[helper.make_tensor_value_info(name,TensorProto.INT64,['batch','sequence']) for name in ['input_ids','attention_mask','token_type_ids']]
 nodes=[helper.make_node('Cast',['input_ids'],['floats'],to=TensorProto.FLOAT)]
 if kind=='embedding':
  nodes += [helper.make_node('Unsqueeze',['floats'],['column'],axes=[2]),helper.make_node('Concat',['column']*4,['last_hidden_state'],axis=2)]
  output=helper.make_tensor_value_info('last_hidden_state',TensorProto.FLOAT,['batch','sequence',4])
 else:
  nodes += [helper.make_node('ReduceMean',['floats'],['logits'],axes=[1],keepdims=1)]
  output=helper.make_tensor_value_info('logits',TensorProto.FLOAT,['batch',1])
 model=helper.make_model(helper.make_graph(nodes,'synthetic-contract-fixture',inputs,[output]),opset_imports=[helper.make_opsetid('',11)],ir_version=7)
 onnx.checker.check_model(model)
 onnx.save(model,str(folder/'onnx/model.onnx'))

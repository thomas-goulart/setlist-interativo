const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL)
    .then(() => console.log('Conectado ao MongoDB Atlas com sucesso!'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

const configSchema = new mongoose.Schema({
    limite_pedidos: { type: String, default: 'ilimitado' },
    show_liberado: { type: String, default: 'nao' },
    subtitulo: { type: String, default: '' },
    event_id: { type: String, default: () => Date.now().toString() }
});

const musicaSchema = new mongoose.Schema({
    id: { type: String, required: true },
    titulo: { type: String, required: true },
    artista: { type: String, required: true },
    genero: { type: String, default: '' },
    origem: { type: String, default: 'Nacional' }
});

const pedidoSchema = new mongoose.Schema({
    pedido_id: { type: String, required: true },
    titulo: { type: String, required: true },
    artista: { type: String, required: true },
    dedicatoria: { type: String, default: '' },
    status: { type: String, default: 'pendente' },
    votos: { type: Number, default: 1 }
});

const AppData = mongoose.model('AppData', new mongoose.Schema({
    tipo: { type: String, default: 'dados_gerais', unique: true },
    config: configSchema,
    repertorio: [musicaSchema],
    fila: [pedidoSchema]
}));

async function lerDados() {
    let dados = await AppData.findOne({ tipo: 'dados_gerais' });
    if (!dados) {
        dados = new AppData({
            tipo: 'dados_gerais',
            config: { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '', event_id: Date.now().toString() },
            repertorio: [],
            fila: []
        });
        await dados.save();
    }
    if (!dados.config) {
        dados.config = { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '', event_id: Date.now().toString() };
    }
    if (!dados.config.event_id) {
        dados.config.event_id = Date.now().toString();
        await dados.save();
    }
    return dados;
}

async function salvarDados(dadosObj) {
    await dadosObj.save();
}

const ADMIN_USER = 'admin';
const ADMIN_PASS = '123456';

function autenticarAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ erro: 'Token não fornecido.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const [usuario, senha] = decoded.split(':');
        if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
            next();
        } else {
            res.status(401).json({ erro: 'Credenciais inválidas.' });
        }
    } catch (e) {
        res.status(401).json({ erro: 'Token inválido.' });
    }
}

app.post('/api/login', autenticarAdmin, (req, res) => {
    res.json({ sucesso: true, mensagem: 'Autenticado com sucesso!' });
});

app.get('/api/config', async (req, res) => {
    const dados = await lerDados();
    res.json(dados.config || {});
});

app.post('/api/config', autenticarAdmin, async (req, res) => {
    const { limite_pedidos, show_liberado, subtitulo } = req.body;
    const dados = await lerDados();
    if (!dados.config) dados.config = {};
    if (limite_pedidos !== undefined) dados.config.limite_pedidos = limite_pedidos;
    if (show_liberado !== undefined) dados.config.show_liberado = show_liberado;
    if (subtitulo !== undefined) dados.config.subtitulo = subtitulo;
    await salvarDados(dados);
    res.json({ sucesso: true, config: dados.config });
});

app.get('/api/repertorio', async (req, res) => {
    const dados = await lerDados();
    res.json(dados.repertorio || []);
});

app.post('/api/repertorio', autenticarAdmin, async (req, res) => {
    const { titulo, artista, genero, origem } = req.body;
    if (!titulo || !artista) {
        return res.status(400).json({ erro: 'Título e artista são obrigatórios.' });
    }
    const dados = await lerDados();
    if (!dados.repertorio) dados.repertorio = [];

    const musicaDuplicada = dados.repertorio.some(m => 
        m.titulo.trim().toLowerCase() === titulo.trim().toLowerCase() && 
        m.artista.trim().toLowerCase() === artista.trim().toLowerCase()
    );

    if (musicaDuplicada) {
        return res.status(400).json({ erro: 'Esta música já está cadastrada no repertório!' });
    }

    const novaMusica = { 
        id: Date.now().toString(), 
        titulo: titulo.trim(), 
        artista: artista.trim(), 
        genero: genero ? genero.trim() : '', 
        origem: origem || 'Nacional' 
    };

    dados.repertorio.push(novaMusica);
    await salvarDados(dados);
    res.status(201).json({ sucesso: true, musica: novaMusica });
});

app.put('/api/repertorio/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { titulo, artista, genero, origem } = req.body;
    const dados = await lerDados();
    const musica = (dados.repertorio || []).find(m => m.id === id);
    if (!musica) {
        return res.status(404).json({ erro: 'Música não encontrada.' });
    }
    if (titulo) musica.titulo = titulo;
    if (artista) musica.artista = artista;
    if (genero !== undefined) musica.genero = genero;
    if (origem) musica.origem = origem;
    await salvarDados(dados);
    res.json({ sucesso: true, musica });
});

app.delete('/api/repertorio/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const dados = await lerDados();
    const tamanhoInicial = (dados.repertorio || []).length;
    dados.repertorio = (dados.repertorio || []).filter(m => m.id !== id);
    if (dados.repertorio.length === tamanhoInicial) {
        return res.status(404).json({ erro: 'Música não encontrada.' });
    }
    await salvarDados(dados);
    res.json({ sucesso: true, mensagem: 'Música excluída.' });
});

app.get('/api/fila', async (req, res) => {
    const dados = await lerDados();
    let fila = dados.fila || [];
    fila.sort((a, b) => (b.votos || 1) - (a.votos || 1));
    res.json(fila);
});

app.post('/api/fila', async (req, res) => {
    const { titulo, artista, dedicatoria, event_id } = req.body;
    if (!titulo || !artista) {
        return res.status(400).json({ erro: 'Título e artista são obrigatórios.' });
    }

    const dados = await lerDados();
    if (!dados.config) dados.config = {};
    
    if (event_id && dados.config.event_id && event_id !== dados.config.event_id) {
        return res.status(400).json({ erro: 'Este show já foi encerrado ou atualizado. Atualize sua página.' });
    }

    if (!dados.fila) dados.fila = [];

    const novoPedido = {
        pedido_id: Date.now().toString(),
        titulo,
        artista,
        dedicatoria: dedicatoria || '',
        status: 'pendente',
        votos: 1
    };

    dados.fila.push(novoPedido);
    await salvarDados(dados);
    res.status(201).json({ sucesso: true, pedido: novoPedido });
});

app.patch('/api/fila/:id/voto', async (req, res) => {
    const { id } = req.params;
    const { event_id } = req.body;
    const dados = await lerDados();
    
    if (event_id && dados.config && dados.config.event_id && event_id !== dados.config.event_id) {
        return res.status(400).json({ erro: 'Este show já foi encerrado ou atualizado.' });
    }

    const pedido = (dados.fila || []).find(p => p.pedido_id === id || p.id === id);

    if (!pedido) {
        return res.status(404).json({ erro: 'Pedido não encontrado na fila.' });
    }

    pedido.votos = (pedido.votos || 1) + 1;
    await salvarDados(dados);
    res.json({ sucesso: true, mensagem: 'Pedido destacado com sucesso!', pedido });
});

app.delete('/api/fila/resetar', autenticarAdmin, async (req, res) => {
    const dados = await lerDados();
    dados.fila = [];
    if(dados.usuarios) dados.usuarios = {};
    
    dados.config.subtitulo = "";
    dados.config.event_id = Date.now().toString();
    
    await salvarDados(dados);
    res.json({ sucesso: true, resetar_local: true, mensagem: 'Fila e subtítulo resetados com sucesso.' });
});

app.delete('/api/fila/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const dados = await lerDados();
    const tamanhoInicial = (dados.fila || []).length;
    dados.fila = (dados.fila || []).filter(p => p.pedido_id !== id && p.id !== id);

    if (dados.fila.length === tamanhoInicial) {
        return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    await salvarDados(dados);
    res.json({ sucesso: true, mensagem: 'Pedido excluído.' });
});

app.patch('/api/fila/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const dados = await lerDados();
    const pedido = (dados.fila || []).find(p => p.pedido_id === id || p.id === id);

    if (!pedido) {
        return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    if (status) {
        pedido.status = status;
        if (status === 'tocada') {
            pedido.votos = Math.max(pedido.votos || 1, 1);
        }
    }
    await salvarDados(dados);
    res.json({ sucesso: true, pedido });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

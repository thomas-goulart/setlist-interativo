const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const ARQUIVO_DADOS = path.join(__dirname, 'dados.json');
const ADMIN_USER = 'admin';
const ADMIN_PASS = '123456';

function lerDados() {
    if (!fs.existsSync(ARQUIVO_DADOS)) {
        const dadosIniciais = { fila: [], repertorio: [], config: { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '' } };
        fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(dadosIniciais, null, 2));
        return dadosIniciais;
    }
    try {
        return JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8'));
    } catch (e) {
        return { fila: [], repertorio: [], config: { limite_pedidos: 'ilimitado', show_liberado: 'nao', subtitulo: '' } };
    }
}

function salvarDados(dados) {
    fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(dados, null, 2));
}

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

app.get('/api/config', (req, res) => {
    res.json(lerDados().config || {});
});

app.post('/api/config', autenticarAdmin, (req, res) => {
    const { limite_pedidos, show_liberado, subtitulo } = req.body;
    const dados = lerDados();
    if (!dados.config) dados.config = {};
    if (limite_pedidos !== undefined) dados.config.limite_pedidos = limite_pedidos;
    if (show_liberado !== undefined) dados.config.show_liberado = show_liberado;
    if (subtitulo !== undefined) dados.config.subtitulo = subtitulo;
    salvarDados(dados);
    res.json({ sucesso: true, config: dados.config });
});

app.get('/api/repertorio', (req, res) => {
    res.json(lerDados().repertorio || []);
});

app.post('/api/repertorio', autenticarAdmin, (req, res) => {
    const { titulo, artista, genero, origem } = req.body;
    if (!titulo || !artista) {
        return res.status(400).json({ erro: 'Título e artista são obrigatórios.' });
    }
    const dados = lerDados();
    if (!dados.repertorio) dados.repertorio = [];
    const novaMusica = { id: Date.now().toString(), titulo, artista, genero: genero || '', origem: origem || 'Nacional' };
    dados.repertorio.push(novaMusica);
    salvarDados(dados);
    res.status(201).json({ sucesso: true, musica: novaMusica });
});

app.put('/api/repertorio/:id', autenticarAdmin, (req, res) => {
    const { id } = req.params;
    const { titulo, artista, genero, origem } = req.body;
    const dados = lerDados();
    const musica = (dados.repertorio || []).find(m => m.id === id);
    if (!musica) {
        return res.status(404).json({ erro: 'Música não encontrada.' });
    }
    if (titulo) musica.titulo = titulo;
    if (artista) musica.artista = artista;
    if (genero !== undefined) musica.genero = genero;
    if (origem) musica.origem = origem;
    salvarDados(dados);
    res.json({ sucesso: true, musica });
});

app.delete('/api/repertorio/:id', autenticarAdmin, (req, res) => {
    const { id } = req.params;
    const dados = lerDados();
    const tamanhoInicial = (dados.repertorio || []).length;
    dados.repertorio = (dados.repertorio || []).filter(m => m.id !== id);
    if (dados.repertorio.length === tamanhoInicial) {
        return res.status(404).json({ erro: 'Música não encontrada.' });
    }
    salvarDados(dados);
    res.json({ sucesso: true, mensagem: 'Música excluída.' });
});

// GET /api/fila: Retorna a fila ordenada automaticamente por votos (maior para o menor)
app.get('/api/fila', (req, res) => {
    const dados = lerDados();
    let fila = dados.fila || [];
    fila.sort((a, b) => (b.votos || 1) - (a.votos || 1));
    res.json(fila);
});

app.post('/api/fila', (req, res) => {
    const { titulo, artista, dedicatoria } = req.body;
    if (!titulo || !artista) {
        return res.status(400).json({ erro: 'Título e artista são obrigatórios.' });
    }

    const dados = lerDados();
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
    salvarDados(dados);
    res.status(201).json({ sucesso: true, pedido: novoPedido });
});

app.patch('/api/fila/:id/voto', (req, res) => {
    const { id } = req.params;
    const dados = lerDados();
    const pedido = (dados.fila || []).find(p => p.pedido_id === id || p.id === id);

    if (!pedido) {
        return res.status(404).json({ erro: 'Pedido não encontrado na fila.' });
    }

    pedido.votos = (pedido.votos || 1) + 1;
    salvarDados(dados);
    res.json({ sucesso: true, mensagem: 'Pedido destacado com sucesso!', pedido });
});

app.delete('/api/fila/resetar', autenticarAdmin, (req, res) => {
    const dados = lerDados();
    dados.fila = [];
    if(dados.usuarios) dados.usuarios = {};
    salvarDados(dados);
    res.json({ sucesso: true, resetar_local: true, mensagem: 'Fila resetada com sucesso.' });
});

app.delete('/api/fila/:id', autenticarAdmin, (req, res) => {
    const { id } = req.params;
    const dados = lerDados();
    const tamanhoInicial = (dados.fila || []).length;
    dados.fila = (dados.fila || []).filter(p => p.pedido_id !== id && p.id !== id);

    if (dados.fila.length === tamanhoInicial) {
        return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    salvarDados(dados);
    res.json({ sucesso: true, mensagem: 'Pedido excluído.' });
});

app.patch('/api/fila/:id', autenticarAdmin, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const dados = lerDados();
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
    salvarDados(dados);
    res.json({ sucesso: true, pedido });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

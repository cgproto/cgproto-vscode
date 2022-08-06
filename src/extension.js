const vscode = require('vscode')
const fs = require('fs')
const http = require('http')
const path = require('path')
const AdmZip = require("adm-zip")

const INDEX_FILE = 'index.cgproto'

// const hostname = '192.168.0.100'
// const port = 3000

function printError(e) {
	console.log(e)
	vscode.window.showErrorMessage(`CGProto-VSCode ${e}`)
}

function host() {
	return vscode.workspace.getConfiguration('cgproto-vscode').get('host')
}
function port() {
	return vscode.workspace.getConfiguration('cgproto-vscode').get('port')
}

function clone(uuid, localPath) {
	http.request({
		hostname: host(), port: port(), method: 'GET', path: `/${uuid}`
	}, res => {
		if (fs.existsSync(localPath)) {
			fs.rmSync(localPath, {recursive: true})
		}
		fs.mkdirSync(localPath)
		const zipPath = path.join(localPath, 'temp.zip')
		const indexPath = path.join(localPath, INDEX_FILE)
		const stream = fs.createWriteStream(zipPath)
		res.pipe(stream)
		stream.on('finish', () => {
			stream.close()
			const zip = new AdmZip(zipPath)
			zip.extractAllTo(localPath, true)
			fs.unlinkSync(zipPath)

			
			fs.writeFileSync(indexPath, JSON.stringify({
				uuid,
				files: zip.getEntries().map(entry => entry.entryName)
			}))

			//vscode.workspace.updateWorkspaceFolders(0, null, {uri: vscode.Uri.file(localPath)})
			vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(localPath));
		}).on('error', () => {
			fs.rmSync(localPath, {recursive: true})
		})
	})
	.on('error', e => printError(e))
	.end()
}

function activate(context) {

	const cloneCmd = vscode.commands.registerCommand('cgproto-vscode.clone', () => {
		http.request({hostname: host(), port: port(), method: 'GET'}, res => {
			res.on('data', data => {
				const list = JSON.parse(data)
				const items = list.map(item => ({ label: item.name, uuid: item.uuid }))
				vscode.window.showQuickPick(items).then(item => {
					if (item === undefined) {
						return
					}
					vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(`${vscode.workspace.rootPath}/${item.label}`) }).then(uri => {
						if (uri) {
							clone(item.uuid, uri.fsPath)
						}
					})
				})
			})
		})
		.on('error', e => printError(e))
		.end()
	})

	const makeCmd = (cmd, cb) => {
		return vscode.commands.registerCommand(cmd, () => {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (workspaceFolders === undefined) {
				return
			}

			const localPaths = workspaceFolders.map(folder => folder.uri.fsPath).filter(localPath => fs.existsSync(path.join(localPath, INDEX_FILE)))
			vscode.window.showQuickPick(localPaths).then((item) => {
				if (item) {
					const indexPath = path.join(item, INDEX_FILE)
					const index = JSON.parse(fs.readFileSync(indexPath))
					cb(item, indexPath, index)
				}
			})
		})
	}
	const pullCmd = makeCmd('cgproto-vscode.pull', (localPath, indexPath, index) => {
		console.log(`pull ${localPath}`)

		http.request({
			hostname: host(), port: port(), method: 'GET', path: `/${index.uuid}`
		}, res => {
			const zipPath = path.join(localPath, 'temp.zip')
			const stream = fs.createWriteStream(zipPath)
			res.pipe(stream)
			stream.on('finish', () => {
				stream.close()
				const zip = new AdmZip(zipPath)
				zip.extractAllTo(localPath, true)
				fs.unlinkSync(zipPath)

				const files = zip.getEntries().map(entry => entry.entryName)
				index.files.forEach(file => {
					if (!files.includes(file)) {
						fs.unlinkSync(path.join(localPath, file))
					}
				})

				fs.writeFileSync(indexPath, JSON.stringify({
					uuid: index.uuid,
					files
				}))
			}).on('error', () => {
				fs.unlinkSync(zipPath)
			})
		})
		.on('error', e => printError(e))
		.end()
	})
	const pushCmd = makeCmd('cgproto-vscode.push', (localPath, indexPath, index) => {
		console.log(`push ${localPath}`)

		const zip = new AdmZip()
		index.files.forEach(file => {
			zip.addLocalFile(path.join(localPath, file), path.dirname(file))
		})
		const buffer = zip.toBuffer()
		const req = http.request({
			hostname: host(), port: port(), method: 'POST', path: `/${index.uuid}`,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Length': buffer.length
			}
		})
		req.on('error', e => printError(e))
		req.write(zip.toBuffer())
		req.end()
		// zip.writeZip(path.join(localPath, 'out.zip'))
	})

	vscode.workspace.onDidSaveTextDocument(document => {
		if (vscode.workspace.getConfiguration('cgproto-vscode').get('autoPush')) {
			const docPath = document.uri.fsPath
			const docFolderPath = path.dirname(docPath)
			const projectPath = path.dirname(docFolderPath)
			const indexPath = path.join(projectPath, INDEX_FILE)
			if (fs.existsSync(indexPath)) {
				const componentID = path.basename(docFolderPath)
				const fileName = path.basename(docPath)
				const relativePath = path.join(componentID, fileName)
				const index = JSON.parse(fs.readFileSync(indexPath))
				if (index.files.includes(relativePath)) {
					const buffer = fs.readFileSync(docPath)
					const req = http.request({
						hostname: host(), port: port(), method: 'POST', path: `/${index.uuid}/${componentID}/${fileName}`,
						headers: {
							'Content-Length': buffer.length
						}
					})
					req.on('error', e => printError(e))
					req.write(buffer)
					req.end()
				}
			}
		}
	})

	context.subscriptions.push(cloneCmd)
	context.subscriptions.push(pullCmd)
	context.subscriptions.push(pushCmd)
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}

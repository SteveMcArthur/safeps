/* eslint no-sync:0 */

// Import
const TaskGroup = require('taskgroup')
const typeChecker = require('typechecker')
const safefs = require('safefs')
const fsUtil = require('fs')
const pathUtil = require('path')
const extractOptsAndCallback = require('extract-opts')

// Prepare
const isWindows = (process.platform || '').indexOf('win') === 0


// =====================================
// Define Globals

// Prepare
if ( global.safepsGlobal == null ) {
	global.safepsGlobal = {}
}

// Define Global Pool
// Create a pool with the concurrency of our max number of open processes
if ( global.safepsGlobal.pool == null ) {
	global.safepsGlobal.pool = new TaskGroup().setConfig({
		concurrency: process.env.NODE_MAX_OPEN_PROCESSES == null ? 100 : process.env.NODE_MAX_OPEN_PROCESSES,
		pauseOnError: false
	}).run()
}


// =====================================
// Define Module

/**
* Contains methods to safely spawn and manage
* various file system processes. It differs 
* from the standard node.js child_process
* (https://nodejs.org/docs/v0.11.13/api/child_process.html#child_process_child_process)
* module in that it intercepts and handles
* many common errors that might occur when
* invoking child processes that could cause
* an application to crash. Most commonly, errors
* such as ENOENT and EACCESS. This enables
* an application to be both cleaner and more robust.
* @class safeps
* @static
*/
const safeps = {

	// =====================================
	// Open and Close Processes

	/**
	* Open a file.
	* Pass your callback to fire when it is safe to open the process
	* @method openProcess
	* @param {Function} fn callback
	*/
	openProcess: function (fn) {
		// Add the task to the pool and execute it right away
		global.safepsGlobal.pool.addTask(fn)

		// Chain
		return safeps
	},


	// =================================
	// Environments
	// @TODO These should be abstracted out into their own packages

	/**
	* Returns whether or not we are running on a windows machine
	* @method isWindows
	* @return {Boolean}
	*/
	isWindows: function () {
		return isWindows
	},

	/**
	* Get locale code - eg: en-AU,
	* fr-FR, zh-CN etc.
	* @method getLocaleCode
	* @param {String} lang
	* @return {String}
	*/
	getLocaleCode: function (lang) {
		lang = lang || process.env.LANG || ''
		const localeCode = lang.replace(/\..+/, '').replace('-', '_').toLowerCase() || null
		return localeCode
	},

	/**
	* Given the localeCode, return
	* the language code.
	* @method getLanguageCode
	* @param {String} localeCode
	* @return {String}
	*/
	getLanguageCode: function (localeCode) {
		localeCode = safeps.getLocaleCode(localeCode) || ''
		const languageCode = localeCode.replace(/^([a-z]+)[_-]([a-z]+)$/i, '$1').toLowerCase() || null
		return languageCode
	},

	/**
	* Given the localeCode, return
	* the country code.
	* @method getCountryCode
	* @param {String} localeCode
	* @return {String}
	*/
	getCountryCode: function (localeCode) {
		localeCode = safeps.getLocaleCode(localeCode) || ''
		const countryCode = localeCode.replace(/^([a-z]+)[_-]([a-z]+)$/i, '$2').toLowerCase() || null
		return countryCode
	},


	// =================================
	// Executeable Helpers

	/**
	* Has spawn sync. Returns true
	* if the child_process spawnSync
	* method exists, otherwise false
	* @method hasSpawnSync
	* @return {Boolean}
	*/
	hasSpawnSync: function () {
		return require('child_process').spawnSync != null
	},

	/**
	* Has exec sync. Returns true
	* if the child_process execSync
	* method exists, otherwise false
	* @method hasExecSync
	* @return {Boolean}
	*/
	hasExecSync: function () {
		return require('child_process').execSync != null
	},

	/**
	* Is the path to a file object an executable?
	* Boolean result returned as the isExecutable parameter
	* of the passed callback.
	* next(err, isExecutable)
	* @method isExecutable
	* @param {String} path path to test
	* @param {Object} [opts]
	* @param {Boolean} [opts.sync] true to test sync rather than async
	* @param {Function} next callback
	* @param {Error} next.err
	* @param {Boolean} next.isExecutable
	* @return {Boolean} returned if opts.sync = true
	*/
	isExecutable: function (path, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// Sync?
		if ( opts.sync ) {
			return safeps.isExecutableSync(path, opts, next)
		}

		// Access (Node 0.12+)
		if ( fsUtil.access ) {
			fsUtil.access(path, fsUtil.X_OK, function (err) {
				const isExecutable = !err
				return next(null, isExecutable)
			})
		}

		// Shim
		else {
			require('child_process').exec(path + ' --version', function (err) {
				// If there was no error, then execution worked fine, so we are executable
				if ( !err )  return next(null, true)
				// If there was an error
				// determine if it was an error with trying to run it (not executable)
				// or an error from running it (executable)
				const isExecutable = err.code !== 127 && (/EACCESS|Permission denied/).test(err.message) === false
				return next(null, isExecutable)
			})
		}

		// Chain
		return safeps
	},

	/**
	* Is the path to a file object an executable?
	* Synchronised version of isExecutable 
	* @method isExecutableSync
	* @param {String} path path to test
	* @param {Object} opts
	* @param {Function} [next]
	* @param {Error} next.err
	* @param {Boolean} next.isExecutable
	* @return {Boolean}
	*/
	isExecutableSync: function (path, opts, next) {
		// Prepare
		let isExecutable

		// Access (Node 0.12+)
		if ( fsUtil.accessSync ) {
			try {
				fsUtil.accessSync(path, fsUtil.X_OK)
				isExecutable = true
			}
			catch ( err ) {
				isExecutable = false
			}
		}

		// Shim
		else {
			try {
				require('child_process').execSync(path + ' --version')
				isExecutable = true
			}
			catch ( err ) {
				// If there was an error
				// determine if it was an error with trying to run it (not executable)
				// or an error from running it (executable)
				isExecutable = err.code !== 127 && (/EACCESS|Permission denied/).test(err.message) === false
			}
		}

		// Return
		if ( next ) {
			next(null, isExecutable)
			return safeps
		}
		else {
			return isExecutable
		}
	},

	/**
	* Internal: Prepare options for an execution.
	* Makes sure all options are populated or exist and
	* gives the opportunity to prepopulate some of those
	* options.
	* @private
	* @method prepareExecutableOptions
	* @param {Object} [opts]
	* @param {Stream} [opts.stdin=null] in stream
	* @param {Array} [opts.stdio=null] Child's stdio configuration
	* @param {Boolean} [opts.safe=true]
	* @param {Object} [opts.env=process.env]
	* @return {Object} opts
	*/
	prepareExecutableOptions: function (opts) {
		// Prepare
		opts = opts || {}

		// Ensure all options exist
		if ( typeof opts.stdin === 'undefined' )  opts.stdin = null
		if ( typeof opts.stdio === 'undefined' )  opts.stdio = null

		// By default make sure execution is valid
		if ( opts.safe == null )   opts.safe = true

		// If a direct pipe then don't do output modifiers
		if ( opts.stdio ) {
			opts.read = opts.output = false
			opts.outputPrefix = null
		}

		// Otherwise, set output modifiers
		else {
			if ( opts.read == null )          opts.read = true
			if ( opts.output == null )        opts.output = !!opts.outputPrefix
			if ( opts.outputPrefix == null )  opts.outputPrefix = null
		}

		// By default inherit environment variables
		if ( opts.env == null ) {
			opts.env = process.env
		}
		// If we don't want to inherit environment variables, then don't
		else if ( opts.env === false ) {
			opts.env = null
		}

		// Return
		return opts
	},

	/**
	* Internal: Prepare result of an execution
	* @private
	* @method updateExecutableResult
	* @param {Object} result
	* @param {Object} result.pid  Number Pid of the child process
	* @param {Object} result.output output Array Array of results from stdio output
	* @param {Stream} result.stdout stdout The contents of output
	* @param {Stream} result.stderr stderr The contents of output
	* @param {Number} result.status status The exit code of the child process
	* @param {String} result.signal signal The signal used to kill the child process
	* @param {Error} result.error The error object if the child process failed or timed out
	* @param {Object} [opts]
	* @param {Object} [opts.output]
	* @param {Object} [opts.outputPrefix]
	* @return {Object} result
	*/
	updateExecutableResult: function (result, opts) {
		// If we want to output, then output the correct streams with the correct prefixes
		if ( opts.output ) {
			safeps.outputData(result.stdout, 'stdout', opts.outputPrefix)
			safeps.outputData(result.stderr, 'stderr', opts.outputPrefix)
		}

		// If we already have an error, then don't continue
		if ( result.error ) {
			return result
		}

		// We don't already have an error, so let's check the status code for an error
		// Check if the status code exists, and if it is not zero, zero is the success code
		if ( result.status != null && result.status !== 0 ) {
			let message = 'Command exited with a non-zero status code.'

			// As there won't be that much information on this error, as it was not already provided
			// we should output the stdout if we have it
			if ( result.stdout ) {
				const tmp = safeps.prefixData(result.stdout)
				if ( tmp ) {
					message += "\nThe command's stdout output:\n" + tmp
				}
			}
			// and output the stderr if we have it
			if ( result.stderr ) {
				const tmp = safeps.prefixData(result.stderr)
				if ( tmp ) {
					message += "\nThe command's stderr output:\n" + tmp
				}
			}

			// and create the error from that output
			result.error = new Error(message)
			return result
		}

		// Success
		return result
	},


	/**
	* Internal: prefix data
	* @private
	* @method prefixData
	* @param {Object} data
	* @param {String} [prefix = '>\t']
	* @return {Object} data
	*/
	prefixData: function (data, prefix = '>\t') {
		data = data && data.toString && data.toString() || ''
		if ( prefix && data ) {
			data = prefix + data.trim().replace(/\n/g, '\n' + prefix) + '\n'
		}
		return data
	},

	/**
	* Internal: Set output data
	* @private
	* @method outputData
	* @param {Object} data
	* @param {Object} [channel = 'stdout']
	* @param {Object} prefix
	*/
	outputData: function (data, channel = 'stdout', prefix) {
		if ( data.toString().trim().length !== 0 ) {
			if ( prefix ) {
				data = safeps.prefixData(data, prefix)
			}
			process[channel].write(data)
		}
		return null
	},


	// =================================
	// Spawn

	/**
	* Syncronised version of spawn. Will not return until the 
	* child process has fully closed. Results can be returned
	* from the method call or via a passed callback. Even if
	* a callback is passed to spawnSync, the method will still
	* be syncronised with the child process and the callback will
	* only return after the child process has closed.
	*
	* Simple usage example:
	*
	*	var safeps = require('safeps');
	*	var command = ['npm', 'install', 'jade', '--save'];
	*
	*	//a lot of the time you won't need the opts argument
	*	var opts = {
	*		cwd: __dirname //this is actually pointless in a real application
	*	};
	*
	*	var result = safeps.spawnSync(command, opts);
	*
	*	console.log(result.error);
	*	console.log(result.status);
	*	console.log(result.signal);
	*	console.log("I've finished...");
	*
	* @method spawnSync
	* @param {Array|String} command
	* @param {Object} [opts]
	* @param {String} opts.cwd Current working directory of the child process
	* @param {Array|String} opts.stdio Child's stdio configuration.
	* @param {Array} opts.customFds Deprecated File descriptors for the child to use for stdio.
	* @param {Object} opts.env Environment key-value pairs.
	* @param {Boolean} opts.detached The child will be a process group leader.
	* @param {Number} opts.uid Sets the user identity of the process.
	* @param {Number} opts.gid Sets the group identity of the process
	* @param {Function} [next] callback
	* @param {Error} next.error
	* @param {Stream} next.stdout out stream
	* @param {Stream} next.stderr error stream
	* @param {Number} next.status node.js exit code
	* @param {String} next.signal unix style signal such as SIGKILL or SIGHUP	
	* @return {Object} {error, pid, output, stdout, stderr, status, signal}
	*/
	spawnSync: function (command, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		opts = safeps.prepareExecutableOptions(opts)
		opts.sync = true

		// If the command is a string, then convert it into an array
		if ( typeChecker.isString(command) ) {
			command = command.split(' ')
		}

		// Get correct executable path
		// Only possible if sync abilities are possible (node 0.12 and up) or if it is cached
		// Otherwise, don't worry about it and output a warning to stderr
		if ( opts.safe ) {
			let wasSync = 0
			safeps.getExecPath(command[0], opts, function (err, execPath) {
				if ( err )  return
				command[0] = execPath
				wasSync = 1
			})
			if ( wasSync === 0 ) {
				process.stderr.write('safeps.spawnSync: was unable to get the executable path synchronously')
			}
		}

		// Spawn Synchronously
		let result = require('child_process').spawnSync(command[0], command.slice(1), opts)
		safeps.updateExecutableResult(result, opts)

		// Complete
		if ( next ) {
			next(result.error, result.stdout, result.stderr, result.status, result.signal)
		}
		else {
			return result
		}
	},

	/**
	* Wrapper around node's spawn command for a cleaner, more robust and powerful API.
	* Launches a new process with the given command. Command line arguments are
	* part of the command parameter (unlike the node.js spawn). Command can be
	* an array of command line arguments or a command line string. Opts allows
	* additional options to be sent to the spawning action.
	*
	* Simple usage example:
	*
	* 	var safeps = require('safeps');
	*	var command = ['npm', 'install','jade','--save'];
	*
	*	//a lot of the time you won't need the opts argument
	*	var opts = {
	*		cwd: __dirname //this is actually pointless in a real application
	*	}
	*	function myCallback(error, stdout, stderr, status, signal){
	*		console.log(error); 
	*		console.log(status);
	*		console.log(signal);
	*		console.log("I've finished...");
	*	}
	*	safeps.spawn(command, opts, myCallback);
	*
	* @method spawn
	* @param {Array|String} command
	* @param {Object} [opts]
	* @param {String} opts.cwd Current working directory of the child process
	* @param {Array|String} opts.stdio Child's stdio configuration.
	* @param {Array} opts.customFds Deprecated File descriptors for the child to use for stdio.
	* @param {Object} opts.env Environment key-value pairs.
	* @param {Boolean} opts.detached The child will be a process group leader.
	* @param {Number} opts.uid Sets the user identity of the process.
	* @param {Number} opts.gid Sets the group identity of the process.
	* @param {Function} next callback
	* @param {Error} next.error
	* @param {Stream} next.stdout out stream
	* @param {Stream} next.stderr error stream
	* @param {Number} next.status node.js exit code
	* @param {String} next.signal unix style signal such as SIGKILL or SIGHUP
	*/
	spawn: function (command, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		opts = safeps.prepareExecutableOptions(opts)

		// Check if we want sync instead
		if ( opts.sync ) {
			return safeps.spawnSync(command, opts, next)
		}

		// Patience
		safeps.openProcess(function (closeProcess) {
			// If the command is a string, then convert it into an array
			if ( typeChecker.isString(command) ) {
				command = command.split(' ')
			}

			// Prepare
			const result = {
				pid: null,
				stdout: null,
				stderr: null,
				output: null,
				error: null,
				status: null,
				signal: null
			}
			let exited = false

			// Tasks
			const tasks = new TaskGroup().done(function (err) {
				exited = true
				closeProcess()
				next(err || result.error, result.stdout, result.stderr, result.status, result.signal)
			})

			// Get correct executable path
			if ( opts.safe ) {
				tasks.addTask(function (complete) {
					safeps.getExecPath(command[0], opts, function (err, execPath) {
						if ( err )  return complete(err)
						command[0] = execPath
						complete()
					})
				})
			}

			// Spawn
			tasks.addTask(function (complete) {
				// Spawn
				result.pid = require('child_process').spawn(command[0], command.slice(1), opts)

				// Write if we want to
				// result.pid.stdin may be null of stdio is 'inherit'
				if ( opts.stdin && result.pid.stdin) {
					result.pid.stdin.write(opts.stdin)
					result.pid.stdin.end()
				}

				// Read if we want to by listening to the streams and updating our result variables
				if ( opts.read ) {
					// result.pid.stdout may be null of stdio is 'inherit'
					if ( result.pid.stdout ) {
						result.pid.stdout.on('data', function (data) {
							if ( opts.output ) {
								safeps.outputData(data, 'stdout', opts.outputPrefix)
							}
							if ( result.stdout ) {
								result.stdout = Buffer.concat([result.stdout, data])
							}
							else {
								result.stdout = data
							}
						})
					}

					// result.pid.stderr may be null of stdio is 'inherit'
					if ( result.pid.stderr ) {
						result.pid.stderr.on('data', function (data) {
							if ( opts.output) {
								safeps.outputData(data, 'stderr', opts.outputPrefix)
							}
							if ( result.stderr ) {
								result.stderr = Buffer.concat([result.stderr, data])
							}
							else {
								result.stderr = data
							}
						})
					}
				}

				// Wait
				result.pid.on('close', function (status, signal) {
					// Apply to local global
					result.status = status
					result.signal = signal

					// Check if we have already exited due to domains
					// as without this, then we will fire the completion callback twice
					// once for the domain error that will happen first
					// then again for the close error
					// if it happens the other way round, close, then error, we want to be alerted of that
					if ( exited === true )  return

					// Check result and complete
					opts.output = false
					safeps.updateExecutableResult(result, opts)
					return complete(result.error)
				})
			})

			// Run
			tasks.run()
		})

		// Chain
		return safeps
	},

	// Spawn Multiple
	// next(err, results), results = [...result], result = [err,stdout,stderr,status,signal]
	spawnMultiple: function (commands, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		const results = []

		// Be synchronous by default
		if ( opts.concurrency == null )  opts.concurrency = 1

		// Make sure we send back the arguments
		const tasks = new TaskGroup().setConfig({concurrency: opts.concurrency}).done(function (err) {
			next(err, results)
		})

		// Prepare tasks
		if ( !typeChecker.isArray(commands) ) {
			commands = [commands]
		}

		// Add tasks
		commands.forEach(function (command) {
			tasks.addTask(function (complete) {
				safeps.spawn(command, opts, function (...args) {
					const err = args[0] || null
					results.push(args)
					complete(err)
				})
			})
		})

		// Run the tasks
		tasks.run()

		// Chain
		return safeps
	},


	// =================================
	// Exec

	// Exec Sync
	// return {error, stdout}
	// next(error, stdout, stderr)
	// @NOTE:
	// stdout and stderr should be Buffers but they are strings unless encoding:null
	// for now, nothing we should do, besides wait for joyent to reply
	// https://github.com/joyent/node/issues/5833#issuecomment-82189525
	execSync: function (command, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		opts = safeps.prepareExecutableOptions(opts)
		opts.sync = true

		// Output
		if ( opts.output === true && !opts.outputPrefix ) {
			opts.stdio = 'inherit'
			opts.output = null
		}

		// Spawn Synchronously
		let stdout, error
		try {
			stdout = require('child_process').execSync(command, opts)
		}
		catch ( err ) {
			error = err
		}

		// Check result
		const result = {error, stdout}
		safeps.updateExecutableResult(result, opts)

		// Complete
		if ( next ) {
			next(result.error, result.stdout, result.stderr)
		}
		else {
			return result
		}
	},

	// Exec
	// Wrapper around node's exec command for a cleaner and more powerful API
	// next(err, stdout, stderr)
	// @NOTE:
	// stdout and stderr should be Buffers but they are strings unless encoding:null
	// for now, nothing we should do, besides wait for joyent to reply
	// https://github.com/joyent/node/issues/5833#issuecomment-82189525
	exec: function (command, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		opts = safeps.prepareExecutableOptions(opts)

		// Check if we want sync instead
		if ( opts.sync ) {
			return safeps.execSync(command, opts, next)
		}

		// Patience
		safeps.openProcess(function (closeProcess) {
			// Output
			if ( opts.output === true && !opts.outputPrefix ) {
				opts.stdio = 'inherit'
				opts.output = null
			}

			// Execute command
			require('child_process').exec(command, opts, function (error, stdout, stderr) {
				// Complete the task
				closeProcess()

				// Prepare result
				const result = {error, stdout, stderr}
				safeps.updateExecutableResult(result, opts)

				// Complete
				return next(result.error, result.stdout, result.stderr)
			})
		})

		// Chain
		return safeps
	},

	// Exec Multiple
	// next(err, results), results = [result...], result = [err,stdout,stderr]
	execMultiple: function (commands, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		const results = []

		// Be synchronous by default
		if ( opts.concurrency == null )  opts.concurrency = 1

		// Make sure we send back the arguments
		const tasks = new TaskGroup().setConfig({concurrency: opts.concurrency}).done(function (err) {
			next(err, results)
		})

		// Prepare tasks
		if ( !typeChecker.isArray(commands) ) {
			commands = [commands]
		}

		// Add tasks
		commands.forEach(function (command) {
			tasks.addTask(function (complete) {
				safeps.exec(command, opts, function (...args) {
					const err = args[0] || null
					results.push(args)
					complete(err)
				})
			})
		})

		// Run the tasks
		tasks.run()

		// Chain
		return safeps
	},


	// =================================
	// Paths

	// Determine an executable path
	// next(err,execPath)
	determineExecPath: function (possibleExecPaths, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)
		let execPath = null

		// By default don't be sync
		if ( opts.sync == null )  opts.sync = false

		// Group
		const tasks = new TaskGroup({sync: opts.sync}).done(function (err) {
			return next(err, execPath)
		})

		// Handle
		possibleExecPaths.forEach(function (possibleExecPath) {
			// Check if the path is invalid, if it is, skip it
			if ( !possibleExecPath )  return
			tasks.addTask(function (complete) {
				// Check if we have found the valid exec path earlier, if so, skip
				if ( execPath )  return complete()

				// Resolve the path as it may be a virtual or relative path
				possibleExecPath = pathUtil.resolve(possibleExecPath)

				// Check if the executeable exists
				safeps.isExecutable(possibleExecPath, opts, function (err, isExecutable) {
					if ( err || !isExecutable )  return complete()
					execPath = possibleExecPath
					return complete()
				})
			})
		})

		// Fire the tasks
		tasks.run()

		// Chain
		return safeps
	},

	// Get Environment Paths
	getEnvironmentPaths: function () {
		// Fetch system include paths with the correct delimiter for the system
		const environmentPaths = process.env.PATH.split(pathUtil.delimiter)

		// Return
		return environmentPaths
	},

	// Get Standard Paths
	getStandardExecPaths: function (execName) {
		// Fetch
		let standardExecPaths = [process.cwd()].concat(safeps.getEnvironmentPaths())

		// Get the possible exec paths
		if ( execName ) {
			standardExecPaths = standardExecPaths.map(function (path) {
				return pathUtil.join(path, execName)
			})
		}

		// Return
		return standardExecPaths
	},

	// Get Possible Exec Paths
	getPossibleExecPaths: function (execName) {
		let possibleExecPaths

		// Fetch available paths
		if ( isWindows && execName.indexOf('.') === -1 ) {
			// we are for windows add the paths for .exe as well
			const standardExecPaths = safeps.getStandardExecPaths(execName)
			possibleExecPaths = []
			for ( const standardExecPath of standardExecPaths ) {
				possibleExecPaths.push(
					standardExecPath,
					standardExecPath + '.exe',
					standardExecPath + '.cmd',
					standardExecPath + '.bat'
				)
			}
		}
		else {
			// we are normal, try the paths
			possibleExecPaths = safeps.getStandardExecPaths(execName)
		}

		// Return
		return possibleExecPaths
	},

	// Exec Path Cache
	execPathCache: {},

	// Get an Exec Path
	// We should not absolute relative paths, as relative paths should be attempt at each possible path
	// next(err,foundPath)
	getExecPath: function (execName, opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// By default read from the cache and write to the cache
		if ( opts.cache == null )  opts.cache = true

		// Check for absolute path, as we would not be needed and would just currupt the output
		if ( execName.substr(0, 1) === '/' || execName.substr(1, 1) === ':' ) {
			next(null, execName)
			return safeps
		}

		// Prepare
		const execNameCapitalized = execName[0].toUpperCase() + execName.substr(1)
		const getExecMethodName = 'get' + execNameCapitalized + 'Path'

		// Check for special case
		if ( safeps[getExecMethodName] ) {
			return safeps[getExecMethodName](opts, next)
		}
		else {
			// Check for cache
			if ( opts.cache && safeps.execPathCache[execName] ) {
				next(null, safeps.execPathCache[execName])
				return safeps
			}

			// Fetch possible exec paths
			const possibleExecPaths = safeps.getPossibleExecPaths(execName)

			// Forward onto determineExecPath
			// Which will determine which path it is out of the possible paths
			safeps.determineExecPath(possibleExecPaths, opts, function (err, execPath) {
				if ( err ) {
					next(err)
				}
				else if ( !execPath ) {
					err = new Error(`Could not locate the ${execName} executable path`)
					next(err)
				}
				else {
					// Success, write the result to cache and send to our callback
					if ( opts.cache )  safeps.execPathCache[execName] = execPath
					return next(null, execPath)
				}
			})
		}

		// Chain
		return safeps
	},

	// Get Home Path
	// Based upon home function from: https://github.com/isaacs/osenv
	// next(err,homePath)
	getHomePath: function (opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// By default read from the cache and write to the cache
		if ( opts.cache == null )  opts.cache = true

		// Cached
		if ( opts.cache && safeps.cachedHomePath ) {
			next(null, safeps.cachedHomePath)
			return safeps
		}

		// Fetch
		const homePath = process.env.USERPROFILE || process.env.HOME || null

		// Success, write the result to cache and send to our callback
		if ( opts.cache )  safeps.cachedHomePath = homePath
		next(null, homePath)

		// Chain
		return safeps
	},

	// Get Tmp Path
	// Based upon tmpdir function from: https://github.com/isaacs/osenv
	// next(err,tmpPath)
	getTmpPath: function (opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// By default read from the cache and write to the cache
		if ( opts.cache == null )  opts.cache = true

		// Cached
		if ( opts.cache && safeps.cachedTmpPath ) {
			next(null, safeps.cachedTmpPath)
			return safeps
		}

		// Prepare
		const tmpDirName = isWindows ? 'temp' : 'tmp'

		// Try the OS environment temp path
		let tmpPath = process.env.TMPDIR || process.env.TMP || process.env.TEMP || null

		// Fallback
		if ( !tmpPath ) {
			// Try the user directory temp path
			safeps.getHomePath(opts, function (err, homePath) {
				if ( err )  return next(err)
				tmpPath = pathUtil.resolve(homePath, tmpDirName)

				// Fallback
				if ( !tmpPath ) {
					// Try the system temp path
					// @TODO perhaps we should check if we have write access to this path
					tmpPath = isWindows
						? pathUtil.resolve(process.env.windir || 'C:\\Windows', tmpDirName)
						: '/tmp'
				}
			})
		}

		// Check if we couldn't find it, we should always be able to find it
		if ( !tmpPath ) {
			const err = new Error("Wan't able to find a temporary path")
			next(err)
		}

		// Success, write the result to cache and send to our callback
		if ( opts.cache )  safeps.cachedTmpPath = tmpPath
		next(null, tmpPath)

		// Chain
		return safeps
	},

	// Get Git Path
	// As `git` is not always available to use, we should check common path locations
	// and if we find one that works, then we should use it
	// next(err,gitPath)
	getGitPath: function (opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// By default read from the cache and write to the cache
		if ( opts.cache == null )  opts.cache = true

		// Cached
		if ( opts.cache && safeps.cachedGitPath ) {
			next(null, safeps.cachedGitPath)
			return safeps
		}

		// Prepare
		const execName = isWindows ? 'git.exe' : 'git'
		const possibleExecPaths = []

		// Add environment paths
		if ( process.env.GIT_PATH )  possibleExecPaths.push(process.env.GIT_PATH)
		if ( process.env.GITPATH  )  possibleExecPaths.push(process.env.GITPATH)

		// Add standard paths
		possibleExecPaths.push(...safeps.getStandardExecPaths(execName))

		// Add custom paths
		if ( isWindows ) {
			possibleExecPaths.push(
				`/Program Files (x64)/Git/bin/${execName}`,
				`/Program Files (x86)/Git/bin/${execName}`,
				`/Program Files/Git/bin/${execName}`
			)
		}
		else {
			possibleExecPaths.push(
				`/usr/local/bin/${execName}`,
				`/usr/bin/${execName}`,
				`~/bin/${execName}`
			)
		}

		// Determine the right path
		safeps.determineExecPath(possibleExecPaths, opts, function (err, execPath) {
			if ( err ) {
				next(err)
			}
			else if ( !execPath ) {
				err = new Error('Could not locate git binary')
				next(err)
			}
			else {
				// Success, write the result to cache and send to our callback
				if ( opts.cache )  safeps.cachedGitPath = execPath
				next(null, execPath)
			}
		})

		// Chain
		return safeps
	},

	// Get Node Path
	// As `node` is not always available to use, we should check common path locations
	// and if we find one that works, then we should use it
	// next(err,nodePath)
	getNodePath: function (opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// By default read from the cache and write to the cache
		if ( opts.cache == null )  opts.cache = true

		// Cached
		if ( opts.cache && safeps.cachedNodePath ) {
			next(null, safeps.cachedNodePath)
			return safeps
		}

		// Prepare
		const execName = isWindows ? 'node.exe' : 'node'
		const possibleExecPaths = []

		// Add environment paths
		if ( process.env.NODE_PATH )                  possibleExecPaths.push(process.env.NODE_PATH)
		if ( process.env.NODEPATH )                   possibleExecPaths.push(process.env.NODEPATH)
		if ( /node(.exe)?$/.test(process.execPath) )  possibleExecPaths.push(process.execPath)

		// Add standard paths
		possibleExecPaths.push(...safeps.getStandardExecPaths(execName))

		// Add custom paths
		if ( isWindows ) {
			possibleExecPaths.push(
				`/Program Files (x64)/nodejs/${execName}`,
				`/Program Files (x86)/nodejs/${execName}`,
				`/Program Files/nodejs/${execName}`
			)
		}
		else {
			possibleExecPaths.push(
				`/usr/local/bin/${execName}`,
				`/usr/bin/${execName}`,
				`~/bin/${execName}`  // User and Heroku
			)
		}

		// Determine the right path
		safeps.determineExecPath(possibleExecPaths, opts, function (err, execPath) {
			if ( err ) {
				next(err)
			}
			else if ( !execPath ) {
				err = new Error('Could not locate node binary')
				next(err)
			}
			else {
				// Success, write the result to cache and send to our callback
				if ( opts.cache )  safeps.cachedNodePath = execPath
				next(null, execPath)
			}
		})

		// Chain
		return safeps
	},


	// Get Npm Path
	// As `npm` is not always available to use, we should check common path locations
	// and if we find one that works, then we should use it
	// next(err,npmPath)
	getNpmPath: function (opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// By default read from the cache and write to the cache
		if ( opts.cache == null )  opts.cache = true

		// Cached
		if ( opts.cache && safeps.cachedNpmPath ) {
			next(null, safeps.cachedNpmPath)
			return safeps
		}

		// Prepare
		const execName = isWindows ? 'npm.cmd' : 'npm'
		const possibleExecPaths = []

		// Add environment paths
		if ( process.env.NPM_PATH )                   possibleExecPaths.push(process.env.NPM_PATH)
		if ( process.env.NPMPATH )                    possibleExecPaths.push(process.env.NPMPATH)
		if ( /node(.exe)?$/.test(process.execPath) )  possibleExecPaths.push(process.execPath.replace(/node(.exe)?$/, execName))

		// Add standard paths
		possibleExecPaths.push(...safeps.getStandardExecPaths(execName))

		// Add custom paths
		if ( isWindows ) {
			possibleExecPaths.push(
				`/Program Files (x64)/nodejs/${execName}`,
				`/Program Files (x86)/nodejs/${execName}`,
				`/Program Files/nodejs/${execName}`
			)
		}
		else {
			possibleExecPaths.push(
				`/usr/local/bin/${execName}`,
				`/usr/bin/${execName}`,
				`~/node_modules/.bin/${execName}` // User and Heroku
			)
		}

		// Determine the right path
		safeps.determineExecPath(possibleExecPaths, opts, function (err, execPath) {
			if ( err ) {
				next(err)
			}
			else if ( !execPath ) {
				err = new Error('Could not locate npm binary')
				next(err)
			}
			else {
				// Success, write the result to cache and send to our callback
				if ( opts.cache )  safeps.cachedNpmPath = execPath
				next(null, execPath)
			}
		})

		// Chain
		return safeps
	},


	// =================================
	// Special Commands
	// @TODO These should be abstracted out into their own packages

	// Initialize a Git Repository
	// Requires internet access
	// opts = {path,remote,url,branch,log,output}
	// next(err)
	initGitRepo: function (opts, next) {
		// Extract
		[opts, next] = extractOptsAndCallback(opts, next)

		// Defaults
		if ( !opts.cwd )     opts.cwd = process.cwd()
		if ( !opts.remote )  opts.remote = 'origin'
		if ( !opts.branch )  opts.branch = 'master'

		// Prepare commands
		const commands = []
		commands.push(['git', 'init'])
		if ( opts.url ) {
			commands.push(['git', 'remote', 'add', opts.remote, opts.url])
		}
		commands.push(['git', 'fetch', opts.remote])
		commands.push(['git', 'pull', opts.remote, opts.branch])
		commands.push(['git', 'submodule', 'init'])
		commands.push(['git', 'submodule', 'update', '--recursive'])

		// Perform commands
		safeps.spawnMultiple(commands, opts, next)

		// Chain
		return safeps
	},

	// Initialize or Pull a Git Repo
	initOrPullGitRepo: function (opts, next) {
		// Extract
		[opts, next] = extractOptsAndCallback(opts, next)

		// Defaults
		if ( !opts.cwd )     opts.cwd = process.cwd()
		if ( !opts.remote )  opts.remote = 'origin'
		if ( !opts.branch )  opts.branch = 'master'

		// Check if it exists
		safefs.ensurePath(opts.cwd, function (err, exists) {
			if ( err ) {
				next(err)
			}
			else if ( exists ) {
				safeps.spawn(['git', 'pull', opts.remote, opts.branch], opts, function (err, ...result) {
					next(err, 'pull', result)
				})
			}
			else {
				safeps.initGitRepo(opts, function (err, result) {
					next(err, 'init', result)
				})
			}
		})

		// Chain
		return safeps
	},

	// Init Node Modules
	// with cross platform support
	// supports linux, heroku, osx, windows
	// next(err, results)
	initNodeModules: function (opts, next) {
		// Prepare
		[opts, next] = extractOptsAndCallback(opts, next)

		// Defaults
		if ( !opts.cwd )           opts.cwd = process.cwd()
		if ( opts.args == null )   opts.args = []
		if ( opts.force == null )  opts.force = false

		// Paths
		const packageJsonPath = pathUtil.join(opts.cwd, 'package.json')
		const nodeModulesPath = pathUtil.join(opts.cwd, 'node_modules')

		// Split this commands into parts
		function partTwo () {
			// If there is no package.json file, then we can't do anything
			safefs.exists(packageJsonPath, function (exists) {
				if ( !exists )  return next()

				// Prepare command
				const command = ['npm', 'install'].concat(opts.args)

				// Execute npm install inside the pugin directory
				safeps.spawn(command, opts, next)
			})
		}
		function partOne () {
			// If we are not forcing, then skip if node_modules already exists
			if ( !opts.force ) {
				safefs.exists(nodeModulesPath, function (exists) {
					if ( exists )  return next()
					partTwo()
				})
			}
			else {
				partTwo()
			}
		}

		// Run the first part
		partOne()

		// Chain
		return safeps
	},

	// Spawn a Node Module
	// with cross platform support
	// supports linux, heroku, osx, windows
	// spawnNodeModule(name:string, args:array, opts:object, next:function)
	// Better than https://github.com/mafintosh/npm-execspawn as it uses safeps
	// next(err, results)
	spawnNodeModule: function (...args) {
		// Prepare
		const opts = {cwd: process.cwd()}
		let next

		// Extract options
		for ( const arg of args ) {
			const type = typeof arg
			if ( Array.isArray(arg) ) {
				opts.args = arg
			}
			else if ( type === 'object' ) {
				if ( arg.next ) {
					next = arg.next
					arg.next = null
				}
				for ( const key of Object.keys(arg) ) {
					opts[key] = arg[key]
				}
			}
			else if ( type === 'function' ) {
				next = arg
			}
			else if ( type === 'string' ) {
				opts.name = arg
			}
		}

		// Command
		let command
		if ( opts.name ) {
			command = [opts.name].concat(opts.args || [])
			opts.name = null
		}
		else {
			command = [].concat(opts.args || [])
		}

		// Clean up
		opts.args = null

		// Paths
		command[0] = pathUtil.join(opts.cwd, 'node_modules', '.bin', command[0])

		// Spawn
		safeps.spawn(command, opts, next)

		// Chain
		return safeps
	}
}

// =====================================
// Export

export default safeps

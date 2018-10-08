(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
jsflow = jsflow || {};
jsflow.Monitor = require('../src/monitor').Monitor;

},{"../src/monitor":37}],2:[function(require,module,exports){
(function (process,__filename){
/** vim: et:ts=4:sw=4:sts=4
 * @license amdefine 0.1.0 Copyright (c) 2011, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/amdefine for details
 */

/*jslint node: true */
/*global module, process */
'use strict';

/**
 * Creates a define for node.
 * @param {Object} module the "module" object that is defined by Node for the
 * current module.
 * @param {Function} [requireFn]. Node's require function for the current module.
 * It only needs to be passed in Node versions before 0.5, when module.require
 * did not exist.
 * @returns {Function} a define function that is usable for the current node
 * module.
 */
function amdefine(module, requireFn) {
    'use strict';
    var defineCache = {},
        loaderCache = {},
        alreadyCalled = false,
        path = require('path'),
        makeRequire, stringRequire;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
        var i, part;
        for (i = 0; ary[i]; i+= 1) {
            part = ary[i];
            if (part === '.') {
                ary.splice(i, 1);
                i -= 1;
            } else if (part === '..') {
                if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                    //End of the line. Keep at least one non-dot
                    //path segment at the front so it can be mapped
                    //correctly to disk. Otherwise, there is likely
                    //no path mapping for a path starting with '..'.
                    //This can still fail, but catches the most reasonable
                    //uses of ..
                    break;
                } else if (i > 0) {
                    ary.splice(i - 1, 2);
                    i -= 2;
                }
            }
        }
    }

    function normalize(name, baseName) {
        var baseParts;

        //Adjust any relative paths.
        if (name && name.charAt(0) === '.') {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                baseParts = baseName.split('/');
                baseParts = baseParts.slice(0, baseParts.length - 1);
                baseParts = baseParts.concat(name.split('/'));
                trimDots(baseParts);
                name = baseParts.join('/');
            }
        }

        return name;
    }

    /**
     * Create the normalize() function passed to a loader plugin's
     * normalize method.
     */
    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(id) {
        function load(value) {
            loaderCache[id] = value;
        }

        load.fromText = function (id, text) {
            //This one is difficult because the text can/probably uses
            //define, and any relative paths and requires should be relative
            //to that id was it would be found on disk. But this would require
            //bootstrapping a module/require fairly deeply from node core.
            //Not sure how best to go about that yet.
            throw new Error('amdefine does not implement load.fromText');
        };

        return load;
    }

    makeRequire = function (systemRequire, exports, module, relId) {
        function amdRequire(deps, callback) {
            if (typeof deps === 'string') {
                //Synchronous, single module require('')
                return stringRequire(systemRequire, exports, module, deps, relId);
            } else {
                //Array of dependencies with a callback.

                //Convert the dependencies to modules.
                deps = deps.map(function (depName) {
                    return stringRequire(systemRequire, exports, module, depName, relId);
                });

                //Wait for next tick to call back the require call.
                process.nextTick(function () {
                    callback.apply(null, deps);
                });
            }
        }

        amdRequire.toUrl = function (filePath) {
            if (filePath.indexOf('.') === 0) {
                return normalize(filePath, path.dirname(module.filename));
            } else {
                return filePath;
            }
        };

        return amdRequire;
    };

    //Favor explicit value, passed in if the module wants to support Node 0.4.
    requireFn = requireFn || function req() {
        return module.require.apply(module, arguments);
    };

    function runFactory(id, deps, factory) {
        var r, e, m, result;

        if (id) {
            e = loaderCache[id] = {};
            m = {
                id: id,
                uri: __filename,
                exports: e
            };
            r = makeRequire(requireFn, e, m, id);
        } else {
            //Only support one define call per file
            if (alreadyCalled) {
                throw new Error('amdefine with no module ID cannot be called more than once per file.');
            }
            alreadyCalled = true;

            //Use the real variables from node
            //Use module.exports for exports, since
            //the exports in here is amdefine exports.
            e = module.exports;
            m = module;
            r = makeRequire(requireFn, e, m, module.id);
        }

        //If there are dependencies, they are strings, so need
        //to convert them to dependency values.
        if (deps) {
            deps = deps.map(function (depName) {
                return r(depName);
            });
        }

        //Call the factory with the right dependencies.
        if (typeof factory === 'function') {
            result = factory.apply(m.exports, deps);
        } else {
            result = factory;
        }

        if (result !== undefined) {
            m.exports = result;
            if (id) {
                loaderCache[id] = m.exports;
            }
        }
    }

    stringRequire = function (systemRequire, exports, module, id, relId) {
        //Split the ID by a ! so that
        var index = id.indexOf('!'),
            originalId = id,
            prefix, plugin;

        if (index === -1) {
            id = normalize(id, relId);

            //Straight module lookup. If it is one of the special dependencies,
            //deal with it, otherwise, delegate to node.
            if (id === 'require') {
                return makeRequire(systemRequire, exports, module, relId);
            } else if (id === 'exports') {
                return exports;
            } else if (id === 'module') {
                return module;
            } else if (loaderCache.hasOwnProperty(id)) {
                return loaderCache[id];
            } else if (defineCache[id]) {
                runFactory.apply(null, defineCache[id]);
                return loaderCache[id];
            } else {
                if(systemRequire) {
                    return systemRequire(originalId);
                } else {
                    throw new Error('No module with ID: ' + id);
                }
            }
        } else {
            //There is a plugin in play.
            prefix = id.substring(0, index);
            id = id.substring(index + 1, id.length);

            plugin = stringRequire(systemRequire, exports, module, prefix, relId);

            if (plugin.normalize) {
                id = plugin.normalize(id, makeNormalize(relId));
            } else {
                //Normalize the ID normally.
                id = normalize(id, relId);
            }

            if (loaderCache[id]) {
                return loaderCache[id];
            } else {
                plugin.load(id, makeRequire(systemRequire, exports, module, relId), makeLoad(id), {});

                return loaderCache[id];
            }
        }
    };

    //Create a define function specific to the module asking for amdefine.
    function define(id, deps, factory) {
        if (Array.isArray(id)) {
            factory = deps;
            deps = id;
            id = undefined;
        } else if (typeof id !== 'string') {
            factory = id;
            id = deps = undefined;
        }

        if (deps && !Array.isArray(deps)) {
            factory = deps;
            deps = undefined;
        }

        if (!deps) {
            deps = ['require', 'exports', 'module'];
        }

        //Set up properties for this module. If an ID, then use
        //internal cache. If no ID, then use the external variables
        //for this node module.
        if (id) {
            //Put the module in deep freeze until there is a
            //require call for it.
            defineCache[id] = [id, deps, factory];
        } else {
            runFactory(id, deps, factory);
        }
    }

    //define.require, which has access to all the values in the
    //cache. Useful for AMD modules that all have IDs in the file,
    //but need to finally export a value to node based on one of those
    //IDs.
    define.require = function (id) {
        if (loaderCache[id]) {
            return loaderCache[id];
        }

        if (defineCache[id]) {
            runFactory.apply(null, defineCache[id]);
            return loaderCache[id];
        }
    };

    define.amd = {};

    return define;
}

module.exports = amdefine;

}).call(this,require('_process'),"/node_modules/amdefine/amdefine.js")
},{"_process":50,"path":49}],3:[function(require,module,exports){
(function (global){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
  Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
  Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
  Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
  Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*global exports:true, require:true, global:true*/
(function () {
    'use strict';

    var Syntax,
        Precedence,
        BinaryPrecedence,
        SourceNode,
        estraverse,
        esutils,
        isArray,
        base,
        indent,
        json,
        renumber,
        hexadecimal,
        quotes,
        escapeless,
        newline,
        space,
        parentheses,
        semicolons,
        safeConcatenation,
        directive,
        extra,
        parse,
        sourceMap,
        FORMAT_MINIFY,
        FORMAT_DEFAULTS;

    estraverse = require('estraverse');
    esutils = require('esutils');

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ComprehensionBlock: 'ComprehensionBlock',
        ComprehensionExpression: 'ComprehensionExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExportDeclaration: 'ExportDeclaration',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        GeneratorExpression: 'GeneratorExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        ImportDeclaration: 'ImportDeclaration',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    Precedence = {
        Sequence: 0,
        Yield: 1,
        Assignment: 1,
        Conditional: 2,
        ArrowFunction: 2,
        LogicalOR: 3,
        LogicalAND: 4,
        BitwiseOR: 5,
        BitwiseXOR: 6,
        BitwiseAND: 7,
        Equality: 8,
        Relational: 9,
        BitwiseSHIFT: 10,
        Additive: 11,
        Multiplicative: 12,
        Unary: 13,
        Postfix: 14,
        Call: 15,
        New: 16,
        Member: 17,
        Primary: 18
    };

    BinaryPrecedence = {
        '||': Precedence.LogicalOR,
        '&&': Precedence.LogicalAND,
        '|': Precedence.BitwiseOR,
        '^': Precedence.BitwiseXOR,
        '&': Precedence.BitwiseAND,
        '==': Precedence.Equality,
        '!=': Precedence.Equality,
        '===': Precedence.Equality,
        '!==': Precedence.Equality,
        'is': Precedence.Equality,
        'isnt': Precedence.Equality,
        '<': Precedence.Relational,
        '>': Precedence.Relational,
        '<=': Precedence.Relational,
        '>=': Precedence.Relational,
        'in': Precedence.Relational,
        'instanceof': Precedence.Relational,
        '<<': Precedence.BitwiseSHIFT,
        '>>': Precedence.BitwiseSHIFT,
        '>>>': Precedence.BitwiseSHIFT,
        '+': Precedence.Additive,
        '-': Precedence.Additive,
        '*': Precedence.Multiplicative,
        '%': Precedence.Multiplicative,
        '/': Precedence.Multiplicative
    };

    function getDefaultOptions() {
        // default options
        return {
            indent: null,
            base: null,
            parse: null,
            comment: false,
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                newline: '\n',
                space: ' ',
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false
            },
            moz: {
                comprehensionExpressionStartsWithAssignment: false,
                starlessGenerator: false,
                parenthesizedComprehensionBlock: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            raw: true,
            verbatim: null
        };
    }

    function stringRepeat(str, num) {
        var result = '';

        for (num |= 0; num > 0; num >>>= 1, str += str) {
            if (num & 1) {
                result += str;
            }
        }

        return result;
    }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function hasLineTerminator(str) {
        return (/[\r\n]/g).test(str);
    }

    function endsWithLineTerminator(str) {
        var len = str.length;
        return len && esutils.code.isLineTerminator(str.charCodeAt(len - 1));
    }

    function updateDeeply(target, override) {
        var key, val;

        function isHashObject(target) {
            return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
        }

        for (key in override) {
            if (override.hasOwnProperty(key)) {
                val = override[key];
                if (isHashObject(val)) {
                    if (isHashObject(target[key])) {
                        updateDeeply(target[key], val);
                    } else {
                        target[key] = updateDeeply({}, val);
                    }
                } else {
                    target[key] = val;
                }
            }
        }
        return target;
    }

    function generateNumber(value) {
        var result, point, temp, exponent, pos;

        if (value !== value) {
            throw new Error('Numeric literal whose value is NaN');
        }
        if (value < 0 || (value === 0 && 1 / value < 0)) {
            throw new Error('Numeric literal whose value is negative');
        }

        if (value === 1 / 0) {
            return json ? 'null' : renumber ? '1e400' : '1e+400';
        }

        result = '' + value;
        if (!renumber || result.length < 3) {
            return result;
        }

        point = result.indexOf('.');
        if (!json && result.charCodeAt(0) === 0x30  /* 0 */ && point === 1) {
            point = 0;
            result = result.slice(1);
        }
        temp = result;
        result = result.replace('e+', 'e');
        exponent = 0;
        if ((pos = temp.indexOf('e')) > 0) {
            exponent = +temp.slice(pos + 1);
            temp = temp.slice(0, pos);
        }
        if (point >= 0) {
            exponent -= temp.length - point - 1;
            temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
        }
        pos = 0;
        while (temp.charCodeAt(temp.length + pos - 1) === 0x30  /* 0 */) {
            --pos;
        }
        if (pos !== 0) {
            exponent -= pos;
            temp = temp.slice(0, pos);
        }
        if (exponent !== 0) {
            temp += 'e' + exponent;
        }
        if ((temp.length < result.length ||
                    (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = '0x' + value.toString(16)).length < result.length)) &&
                +temp === value) {
            result = temp;
        }

        return result;
    }

    // Generate valid RegExp expression.
    // This function is based on https://github.com/Constellation/iv Engine

    function escapeRegExpCharacter(ch, previousIsBackslash) {
        // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
        if ((ch & ~1) === 0x2028) {
            return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
        } else if (ch === 10 || ch === 13) {  // \n, \r
            return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
        }
        return String.fromCharCode(ch);
    }

    function generateRegExp(reg) {
        var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

        result = reg.toString();

        if (reg.source) {
            // extract flag from toString result
            match = result.match(/\/([^/]*)$/);
            if (!match) {
                return result;
            }

            flags = match[1];
            result = '';

            characterInBrack = false;
            previousIsBackslash = false;
            for (i = 0, iz = reg.source.length; i < iz; ++i) {
                ch = reg.source.charCodeAt(i);

                if (!previousIsBackslash) {
                    if (characterInBrack) {
                        if (ch === 93) {  // ]
                            characterInBrack = false;
                        }
                    } else {
                        if (ch === 47) {  // /
                            result += '\\';
                        } else if (ch === 91) {  // [
                            characterInBrack = true;
                        }
                    }
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    previousIsBackslash = ch === 92;  // \
                } else {
                    // if new RegExp("\\\n') is provided, create /\n/
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    // prevent like /\\[/]/
                    previousIsBackslash = false;
                }
            }

            return '/' + result + '/' + flags;
        }

        return result;
    }

    function escapeAllowedCharacter(code, next) {
        var hex, result = '\\';

        switch (code) {
        case 0x08  /* \b */:
            result += 'b';
            break;
        case 0x0C  /* \f */:
            result += 'f';
            break;
        case 0x09  /* \t */:
            result += 't';
            break;
        default:
            hex = code.toString(16).toUpperCase();
            if (json || code > 0xFF) {
                result += 'u' + '0000'.slice(hex.length) + hex;
            } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
                result += '0';
            } else if (code === 0x000B  /* \v */) { // '\v'
                result += 'x0B';
            } else {
                result += 'x' + '00'.slice(hex.length) + hex;
            }
            break;
        }

        return result;
    }

    function escapeDisallowedCharacter(code) {
        var result = '\\';
        switch (code) {
        case 0x5C  /* \ */:
            result += '\\';
            break;
        case 0x0A  /* \n */:
            result += 'n';
            break;
        case 0x0D  /* \r */:
            result += 'r';
            break;
        case 0x2028:
            result += 'u2028';
            break;
        case 0x2029:
            result += 'u2029';
            break;
        default:
            throw new Error('Incorrectly classified character');
        }

        return result;
    }

    function escapeDirective(str) {
        var i, iz, code, quote;

        quote = quotes === 'double' ? '"' : '\'';
        for (i = 0, iz = str.length; i < iz; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                quote = '"';
                break;
            } else if (code === 0x22  /* " */) {
                quote = '\'';
                break;
            } else if (code === 0x5C  /* \ */) {
                ++i;
            }
        }

        return quote + str + quote;
    }

    function escapeString(str) {
        var result = '', i, len, code, singleQuotes = 0, doubleQuotes = 0, single, quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                ++singleQuotes;
            } else if (code === 0x22  /* " */) {
                ++doubleQuotes;
            } else if (code === 0x2F  /* / */ && json) {
                result += '\\';
            } else if (esutils.code.isLineTerminator(code) || code === 0x5C  /* \ */) {
                result += escapeDisallowedCharacter(code);
                continue;
            } else if ((json && code < 0x20  /* SP */) || !(json || escapeless || (code >= 0x20  /* SP */ && code <= 0x7E  /* ~ */))) {
                result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
                continue;
            }
            result += String.fromCharCode(code);
        }

        single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
        quote = single ? '\'' : '"';

        if (!(single ? singleQuotes : doubleQuotes)) {
            return quote + result + quote;
        }

        str = result;
        result = quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if ((code === 0x27  /* ' */ && single) || (code === 0x22  /* " */ && !single)) {
                result += '\\';
            }
            result += String.fromCharCode(code);
        }

        return result + quote;
    }

    /**
     * flatten an array to a string, where the array can contain
     * either strings or nested arrays
     */
    function flattenToString(arr) {
        var i, iz, elem, result = '';
        for (i = 0, iz = arr.length; i < iz; ++i) {
            elem = arr[i];
            result += isArray(elem) ? flattenToString(elem) : elem;
        }
        return result;
    }

    /**
     * convert generated to a SourceNode when source maps are enabled.
     */
    function toSourceNodeWhenNeeded(generated, node) {
        if (!sourceMap) {
            // with no source maps, generated is either an
            // array or a string.  if an array, flatten it.
            // if a string, just return it
            if (isArray(generated)) {
                return flattenToString(generated);
            } else {
                return generated;
            }
        }
        if (node == null) {
            if (generated instanceof SourceNode) {
                return generated;
            } else {
                node = {};
            }
        }
        if (node.loc == null) {
            return new SourceNode(null, null, sourceMap, generated, node.name || null);
        }
        return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
    }

    function noEmptySpace() {
        return (space) ? space : ' ';
    }

    function join(left, right) {
        var leftSource = toSourceNodeWhenNeeded(left).toString(),
            rightSource = toSourceNodeWhenNeeded(right).toString(),
            leftCharCode = leftSource.charCodeAt(leftSource.length - 1),
            rightCharCode = rightSource.charCodeAt(0);

        if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
        esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode) ||
        leftCharCode === 0x2F  /* / */ && rightCharCode === 0x69  /* i */) { // infix word operators all start with `i`
            return [left, noEmptySpace(), right];
        } else if (esutils.code.isWhiteSpace(leftCharCode) || esutils.code.isLineTerminator(leftCharCode) ||
                esutils.code.isWhiteSpace(rightCharCode) || esutils.code.isLineTerminator(rightCharCode)) {
            return [left, right];
        }
        return [left, space, right];
    }

    function addIndent(stmt) {
        return [base, stmt];
    }

    function withIndent(fn) {
        var previousBase, result;
        previousBase = base;
        base += indent;
        result = fn.call(this, base);
        base = previousBase;
        return result;
    }

    function calculateSpaces(str) {
        var i;
        for (i = str.length - 1; i >= 0; --i) {
            if (esutils.code.isLineTerminator(str.charCodeAt(i))) {
                break;
            }
        }
        return (str.length - 1) - i;
    }

    function adjustMultilineComment(value, specialBase) {
        var array, i, len, line, j, spaces, previousBase, sn;

        array = value.split(/\r\n|[\r\n]/);
        spaces = Number.MAX_VALUE;

        // first line doesn't have indentation
        for (i = 1, len = array.length; i < len; ++i) {
            line = array[i];
            j = 0;
            while (j < line.length && esutils.code.isWhiteSpace(line.charCodeAt(j))) {
                ++j;
            }
            if (spaces > j) {
                spaces = j;
            }
        }

        if (typeof specialBase !== 'undefined') {
            // pattern like
            // {
            //   var t = 20;  /*
            //                 * this is comment
            //                 */
            // }
            previousBase = base;
            if (array[1][spaces] === '*') {
                specialBase += ' ';
            }
            base = specialBase;
        } else {
            if (spaces & 1) {
                // /*
                //  *
                //  */
                // If spaces are odd number, above pattern is considered.
                // We waste 1 space.
                --spaces;
            }
            previousBase = base;
        }

        for (i = 1, len = array.length; i < len; ++i) {
            sn = toSourceNodeWhenNeeded(addIndent(array[i].slice(spaces)));
            array[i] = sourceMap ? sn.join('') : sn;
        }

        base = previousBase;

        return array.join('\n');
    }

    function generateComment(comment, specialBase) {
        if (comment.type === 'Line') {
            if (endsWithLineTerminator(comment.value)) {
                return '//' + comment.value;
            } else {
                // Always use LineTerminator
                return '//' + comment.value + '\n';
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
        }
        return '/*' + comment.value + '*/';
    }

    function addComments(stmt, result) {
        var i, len, comment, save, tailingToStatement, specialBase, fragment;

        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            save = result;

            comment = stmt.leadingComments[0];
            result = [];
            if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                result.push('\n');
            }
            result.push(generateComment(comment));
            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push('\n');
            }

            for (i = 1, len = stmt.leadingComments.length; i < len; ++i) {
                comment = stmt.leadingComments[i];
                fragment = [generateComment(comment)];
                if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    fragment.push('\n');
                }
                result.push(addIndent(fragment));
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {
            tailingToStatement = !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
            specialBase = stringRepeat(' ', calculateSpaces(toSourceNodeWhenNeeded([base, result, indent]).toString()));
            for (i = 0, len = stmt.trailingComments.length; i < len; ++i) {
                comment = stmt.trailingComments[i];
                if (tailingToStatement) {
                    // We assume target like following script
                    //
                    // var t = 20;  /**
                    //               * This is comment of t
                    //               */
                    if (i === 0) {
                        // first case
                        result = [result, indent];
                    } else {
                        result = [result, specialBase];
                    }
                    result.push(generateComment(comment, specialBase));
                } else {
                    result = [result, addIndent(generateComment(comment))];
                }
                if (i !== len - 1 && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result = [result, '\n'];
                }
            }
        }

        return result;
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function maybeBlock(stmt, semicolonOptional, functionBody) {
        var result, noLeadingComment;

        noLeadingComment = !extra.comment || !stmt.leadingComments;

        if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
            return [space, generateStatement(stmt, { functionBody: functionBody })];
        }

        if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
            return ';';
        }

        withIndent(function () {
            result = [newline, addIndent(generateStatement(stmt, { semicolonOptional: semicolonOptional, functionBody: functionBody }))];
        });

        return result;
    }

    function maybeBlockSuffix(stmt, result) {
        var ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
        if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
            return [result, space];
        }
        if (ends) {
            return [result, base];
        }
        return [result, newline, base];
    }

    function generateVerbatimString(string) {
        var i, iz, result;
        result = string.split(/\r\n|\n/);
        for (i = 1, iz = result.length; i < iz; i++) {
            result[i] = newline + base + result[i];
        }
        return result;
    }

    function generateVerbatim(expr, option) {
        var verbatim, result, prec;
        verbatim = expr[extra.verbatim];

        if (typeof verbatim === 'string') {
            result = parenthesize(generateVerbatimString(verbatim), Precedence.Sequence, option.precedence);
        } else {
            // verbatim is object
            result = generateVerbatimString(verbatim.content);
            prec = (verbatim.precedence != null) ? verbatim.precedence : Precedence.Sequence;
            result = parenthesize(result, prec, option.precedence);
        }

        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateIdentifier(node) {
        return toSourceNodeWhenNeeded(node.name, node);
    }

    function generatePattern(node, options) {
        var result;

        if (node.type === Syntax.Identifier) {
            result = generateIdentifier(node);
        } else {
            result = generateExpression(node, {
                precedence: options.precedence,
                allowIn: options.allowIn,
                allowCall: true
            });
        }

        return result;
    }

    function generateFunctionBody(node) {
        var result, i, len, expr, arrow;

        arrow = node.type === Syntax.ArrowFunctionExpression;

        if (arrow && node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
            // arg => { } case
            result = [generateIdentifier(node.params[0])];
        } else {
            result = ['('];
            for (i = 0, len = node.params.length; i < len; ++i) {
                result.push(generatePattern(node.params[i], {
                    precedence: Precedence.Assignment,
                    allowIn: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');
        }

        if (arrow) {
            result.push(space);
            result.push('=>');
        }

        if (node.expression) {
            result.push(space);
            expr = generateExpression(node.body, {
                precedence: Precedence.Assignment,
                allowIn: true,
                allowCall: true
            });
            if (expr.toString().charAt(0) === '{') {
                expr = ['(', expr, ')'];
            }
            result.push(expr);
        } else {
            result.push(maybeBlock(node.body, false, true));
        }
        return result;
    }

    function generateIterationForStatement(operator, stmt, semicolonIsNotNeeded) {
        var result = ['for' + space + '('];
        withIndent(function () {
            if (stmt.left.type === Syntax.VariableDeclaration) {
                withIndent(function () {
                    result.push(stmt.left.kind + noEmptySpace());
                    result.push(generateStatement(stmt.left.declarations[0], {
                        allowIn: false
                    }));
                });
            } else {
                result.push(generateExpression(stmt.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                }));
            }

            result = join(result, operator);
            result = [join(
                result,
                generateExpression(stmt.right, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), ')'];
        });
        result.push(maybeBlock(stmt.body, semicolonIsNotNeeded));
        return result;
    }

    function generateVariableDeclaration(stmt, semicolon, allowIn) {
        var result, i, iz, node;

        result = [ stmt.kind ];

        function block() {
            node = stmt.declarations[0];
            if (extra.comment && node.leadingComments) {
                result.push('\n');
                result.push(addIndent(generateStatement(node, {
                    allowIn: allowIn
                })));
            } else {
                result.push(noEmptySpace());
                result.push(generateStatement(node, {
                    allowIn: allowIn
                }));
            }

            for (i = 1, iz = stmt.declarations.length; i < iz; ++i) {
                node = stmt.declarations[i];
                if (extra.comment && node.leadingComments) {
                    result.push(',' + newline);
                    result.push(addIndent(generateStatement(node, {
                        allowIn: allowIn
                    })));
                } else {
                    result.push(',' + space);
                    result.push(generateStatement(node, {
                        allowIn: allowIn
                    }));
                }
            }
        }

        if (stmt.declarations.length > 1) {
            withIndent(block);
        } else {
            block();
        }

        result.push(semicolon);

        return result;
    }

    function generateLiteral(expr) {
        var raw;
        if (expr.hasOwnProperty('raw') && parse && extra.raw) {
            try {
                raw = parse(expr.raw).body[0].expression;
                if (raw.type === Syntax.Literal) {
                    if (raw.value === expr.value) {
                        return expr.raw;
                    }
                }
            } catch (e) {
                // not use raw property
            }
        }

        if (expr.value === null) {
            return 'null';
        }

        if (typeof expr.value === 'string') {
            return escapeString(expr.value);
        }

        if (typeof expr.value === 'number') {
            return generateNumber(expr.value);
        }

        if (typeof expr.value === 'boolean') {
            return expr.value ? 'true' : 'false';
        }

        return generateRegExp(expr.value);
    }

    function generatePropertyKey(expr, computed, option) {
        var result = [];

        if (computed) {
            result.push('[');
        }
        result.push(generateExpression(expr, option));
        if (computed) {
            result.push(']');
        }

        return result;
    }

    function generateExpression(expr, option) {
        var result,
            precedence,
            type,
            currentPrecedence,
            i,
            len,
            fragment,
            multiline,
            leftCharCode,
            leftSource,
            rightCharCode,
            allowIn,
            allowCall,
            allowUnparenthesizedNew,
            property,
            isGenerator;

        precedence = option.precedence;
        allowIn = option.allowIn;
        allowCall = option.allowCall;
        type = expr.type || option.type;

        if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
            return generateVerbatim(expr, option);
        }

        switch (type) {
        case Syntax.SequenceExpression:
            result = [];
            allowIn |= (Precedence.Sequence < precedence);
            for (i = 0, len = expr.expressions.length; i < len; ++i) {
                result.push(generateExpression(expr.expressions[i], {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result = parenthesize(result, Precedence.Sequence, precedence);
            break;

        case Syntax.AssignmentExpression:
            allowIn |= (Precedence.Assignment < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.left, {
                        precedence: Precedence.Call,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + expr.operator + space,
                    generateExpression(expr.right, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Assignment,
                precedence
            );
            break;

        case Syntax.ArrowFunctionExpression:
            allowIn |= (Precedence.ArrowFunction < precedence);
            result = parenthesize(generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
            break;

        case Syntax.ConditionalExpression:
            allowIn |= (Precedence.Conditional < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.test, {
                        precedence: Precedence.LogicalOR,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + '?' + space,
                    generateExpression(expr.consequent, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + ':' + space,
                    generateExpression(expr.alternate, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Conditional,
                precedence
            );
            break;

        case Syntax.LogicalExpression:
        case Syntax.BinaryExpression:
            currentPrecedence = BinaryPrecedence[expr.operator];

            allowIn |= (currentPrecedence < precedence);

            fragment = generateExpression(expr.left, {
                precedence: currentPrecedence,
                allowIn: allowIn,
                allowCall: true
            });

            leftSource = fragment.toString();

            if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPart(expr.operator.charCodeAt(0))) {
                result = [fragment, noEmptySpace(), expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = generateExpression(expr.right, {
                precedence: currentPrecedence + 1,
                allowIn: allowIn,
                allowCall: true
            });

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
            expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                result.push(noEmptySpace());
                result.push(fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !allowIn) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, currentPrecedence, precedence);
            }

            break;

        case Syntax.CallExpression:
            result = [generateExpression(expr.callee, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: true,
                allowUnparenthesizedNew: false
            })];

            result.push('(');
            for (i = 0, len = expr['arguments'].length; i < len; ++i) {
                result.push(generateExpression(expr['arguments'][i], {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');

            if (!allowCall) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, Precedence.Call, precedence);
            }
            break;

        case Syntax.NewExpression:
            len = expr['arguments'].length;
            allowUnparenthesizedNew = option.allowUnparenthesizedNew === undefined || option.allowUnparenthesizedNew;

            result = join(
                'new',
                generateExpression(expr.callee, {
                    precedence: Precedence.New,
                    allowIn: true,
                    allowCall: false,
                    allowUnparenthesizedNew: allowUnparenthesizedNew && !parentheses && len === 0
                })
            );

            if (!allowUnparenthesizedNew || parentheses || len > 0) {
                result.push('(');
                for (i = 0; i < len; ++i) {
                    result.push(generateExpression(expr['arguments'][i], {
                        precedence: Precedence.Assignment,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + space);
                    }
                }
                result.push(')');
            }

            result = parenthesize(result, Precedence.New, precedence);
            break;

        case Syntax.MemberExpression:
            result = [generateExpression(expr.object, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: allowCall,
                allowUnparenthesizedNew: false
            })];

            if (expr.computed) {
                result.push('[');
                result.push(generateExpression(expr.property, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: allowCall
                }));
                result.push(']');
            } else {
                if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                    fragment = toSourceNodeWhenNeeded(result).toString();
                    // When the following conditions are all true,
                    //   1. No floating point
                    //   2. Don't have exponents
                    //   3. The last character is a decimal digit
                    //   4. Not hexadecimal OR octal number literal
                    // we should add a floating point.
                    if (
                            fragment.indexOf('.') < 0 &&
                            !/[eExX]/.test(fragment) &&
                            esutils.code.isDecimalDigit(fragment.charCodeAt(fragment.length - 1)) &&
                            !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)  // '0'
                            ) {
                        result.push('.');
                    }
                }
                result.push('.');
                result.push(generateIdentifier(expr.property));
            }

            result = parenthesize(result, Precedence.Member, precedence);
            break;

        case Syntax.UnaryExpression:
            fragment = generateExpression(expr.argument, {
                precedence: Precedence.Unary,
                allowIn: true,
                allowCall: true
            });

            if (space === '') {
                result = join(expr.operator, fragment);
            } else {
                result = [expr.operator];
                if (expr.operator.length > 2) {
                    // delete, void, typeof
                    // get `typeof []`, not `typeof[]`
                    result = join(result, fragment);
                } else {
                    // Prevent inserting spaces between operator and argument if it is unnecessary
                    // like, `!cond`
                    leftSource = toSourceNodeWhenNeeded(result).toString();
                    leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
                    rightCharCode = fragment.toString().charCodeAt(0);

                    if (((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode) ||
                            (esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode))) {
                        result.push(noEmptySpace());
                        result.push(fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            result = parenthesize(result, Precedence.Unary, precedence);
            break;

        case Syntax.YieldExpression:
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    generateExpression(expr.argument, {
                        precedence: Precedence.Yield,
                        allowIn: true,
                        allowCall: true
                    })
                );
            }
            result = parenthesize(result, Precedence.Yield, precedence);
            break;

        case Syntax.UpdateExpression:
            if (expr.prefix) {
                result = parenthesize(
                    [
                        expr.operator,
                        generateExpression(expr.argument, {
                            precedence: Precedence.Unary,
                            allowIn: true,
                            allowCall: true
                        })
                    ],
                    Precedence.Unary,
                    precedence
                );
            } else {
                result = parenthesize(
                    [
                        generateExpression(expr.argument, {
                            precedence: Precedence.Postfix,
                            allowIn: true,
                            allowCall: true
                        }),
                        expr.operator
                    ],
                    Precedence.Postfix,
                    precedence
                );
            }
            break;

        case Syntax.FunctionExpression:
            isGenerator = expr.generator && !extra.moz.starlessGenerator;
            result = isGenerator ? 'function*' : 'function';

            if (expr.id) {
                result = [result, (isGenerator) ? space : noEmptySpace(),
                          generateIdentifier(expr.id),
                          generateFunctionBody(expr)];
            } else {
                result = [result + space, generateFunctionBody(expr)];
            }

            break;

        case Syntax.ArrayPattern:
        case Syntax.ArrayExpression:
            if (!expr.elements.length) {
                result = '[]';
                break;
            }
            multiline = expr.elements.length > 1;
            result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                for (i = 0, len = expr.elements.length; i < len; ++i) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === len) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '');
                        result.push(generateExpression(expr.elements[i], {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        }));
                    }
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push(']');
            break;

        case Syntax.Property:
            if (expr.kind === 'get' || expr.kind === 'set') {
                result = [
                    expr.kind, noEmptySpace(),
                    generatePropertyKey(expr.key, expr.computed, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    generateFunctionBody(expr.value)
                ];
            } else {
                if (expr.shorthand) {
                    result = generatePropertyKey(expr.key, expr.computed, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });
                } else if (expr.method) {
                    result = [];
                    if (expr.value.generator) {
                        result.push('*');
                    }
                    result.push(generatePropertyKey(expr.key, expr.computed, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(generateFunctionBody(expr.value));
                } else {
                    result = [
                        generatePropertyKey(expr.key, expr.computed, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        }),
                        ':' + space,
                        generateExpression(expr.value, {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        })
                    ];
                }
            }
            break;

        case Syntax.ObjectExpression:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }
            multiline = expr.properties.length > 1;

            withIndent(function () {
                fragment = generateExpression(expr.properties[0], {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true,
                    type: Syntax.Property
                });
            });

            if (!multiline) {
                // issues 4
                // Do not transform from
                //   dejavu.Class.declare({
                //       method2: function () {}
                //   });
                // to
                //   dejavu.Class.declare({method2: function () {
                //       }});
                if (!hasLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result = [ '{', space, fragment, space, '}' ];
                    break;
                }
            }

            withIndent(function (indent) {
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(',' + newline);
                    for (i = 1, len = expr.properties.length; i < len; ++i) {
                        result.push(indent);
                        result.push(generateExpression(expr.properties[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true,
                            type: Syntax.Property
                        }));
                        if (i + 1 < len) {
                            result.push(',' + newline);
                        }
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            break;

        case Syntax.ObjectPattern:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }

            multiline = false;
            if (expr.properties.length === 1) {
                property = expr.properties[0];
                if (property.value.type !== Syntax.Identifier) {
                    multiline = true;
                }
            } else {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    property = expr.properties[i];
                    if (!property.shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }
            result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    result.push(multiline ? indent : '');
                    result.push(generateExpression(expr.properties[i], {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push('}');
            break;

        case Syntax.ThisExpression:
            result = 'this';
            break;

        case Syntax.Identifier:
            result = generateIdentifier(expr);
            break;

        case Syntax.Literal:
            result = generateLiteral(expr);
            break;

        case Syntax.GeneratorExpression:
        case Syntax.ComprehensionExpression:
            // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
            // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6
            result = (type === Syntax.GeneratorExpression) ? ['('] : ['['];

            if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result.push(fragment);
            }

            if (expr.blocks) {
                withIndent(function () {
                    for (i = 0, len = expr.blocks.length; i < len; ++i) {
                        fragment = generateExpression(expr.blocks[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        });

                        if (i > 0 || extra.moz.comprehensionExpressionStartsWithAssignment) {
                            result = join(result, fragment);
                        } else {
                            result.push(fragment);
                        }
                    }
                });
            }

            if (expr.filter) {
                result = join(result, 'if' + space);
                fragment = generateExpression(expr.filter, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                });
                if (extra.moz.parenthesizedComprehensionBlock) {
                    result = join(result, [ '(', fragment, ')' ]);
                } else {
                    result = join(result, fragment);
                }
            }

            if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result = join(result, fragment);
            }

            result.push((type === Syntax.GeneratorExpression) ? ')' : ']');
            break;

        case Syntax.ComprehensionBlock:
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind, noEmptySpace(),
                    generateStatement(expr.left.declarations[0], {
                        allowIn: false
                    })
                ];
            } else {
                fragment = generateExpression(expr.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                });
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, generateExpression(expr.right, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            }));

            if (extra.moz.parenthesizedComprehensionBlock) {
                result = [ 'for' + space + '(', fragment, ')' ];
            } else {
                result = join('for' + space, fragment);
            }
            break;

        default:
            throw new Error('Unknown expression type: ' + expr.type);
        }

        if (extra.comment) {
            result = addComments(expr,result);
        }
        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateStatement(stmt, option) {
        var i,
            len,
            result,
            specifier,
            allowIn,
            functionBody,
            directiveContext,
            fragment,
            semicolon,
            isGenerator,
            guardedHandlers;

        allowIn = true;
        semicolon = ';';
        functionBody = false;
        directiveContext = false;
        if (option) {
            allowIn = option.allowIn === undefined || option.allowIn;
            if (!semicolons && option.semicolonOptional === true) {
                semicolon = '';
            }
            functionBody = option.functionBody;
            directiveContext = option.directiveContext;
        }

        switch (stmt.type) {
        case Syntax.BlockStatement:
            result = ['{', newline];

            withIndent(function () {
                for (i = 0, len = stmt.body.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.body[i], {
                        semicolonOptional: i === len - 1,
                        directiveContext: functionBody
                    }));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });

            result.push(addIndent('}'));
            break;

        case Syntax.BreakStatement:
            if (stmt.label) {
                result = 'break ' + stmt.label.name + semicolon;
            } else {
                result = 'break' + semicolon;
            }
            break;

        case Syntax.ContinueStatement:
            if (stmt.label) {
                result = 'continue ' + stmt.label.name + semicolon;
            } else {
                result = 'continue' + semicolon;
            }
            break;

        case Syntax.DirectiveStatement:
            if (extra.raw && stmt.raw) {
                result = stmt.raw + semicolon;
            } else {
                result = escapeDirective(stmt.directive) + semicolon;
            }
            break;

        case Syntax.DoWhileStatement:
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            result = join('do', maybeBlock(stmt.body));
            result = maybeBlockSuffix(stmt.body, result);
            result = join(result, [
                'while' + space + '(',
                generateExpression(stmt.test, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                }),
                ')' + semicolon
            ]);
            break;

        case Syntax.CatchClause:
            withIndent(function () {
                var guard;

                result = [
                    'catch' + space + '(',
                    generateExpression(stmt.param, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];

                if (stmt.guard) {
                    guard = generateExpression(stmt.guard, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });

                    result.splice(2, 0, ' if ', guard);
                }
            });
            result.push(maybeBlock(stmt.body));
            break;

        case Syntax.DebuggerStatement:
            result = 'debugger' + semicolon;
            break;

        case Syntax.EmptyStatement:
            result = ';';
            break;

        case Syntax.ExportDeclaration:
            result = 'export ';
            if (stmt.declaration) {
                // FunctionDeclaration or VariableDeclaration
                result = [result, generateStatement(stmt.declaration, { semicolonOptional: semicolon === '' })];
                break;
            }
            break;

        case Syntax.ExpressionStatement:
            result = [generateExpression(stmt.expression, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            })];
            // 12.4 '{', 'function' is not allowed in this position.
            // wrap expression with parentheses
            fragment = toSourceNodeWhenNeeded(result).toString();
            if (fragment.charAt(0) === '{' ||  // ObjectExpression
                    (fragment.slice(0, 8) === 'function' && '* ('.indexOf(fragment.charAt(8)) >= 0) ||  // function or generator
                    (directive && directiveContext && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, ')' + semicolon];
            } else {
                result.push(semicolon);
            }
            break;

        case Syntax.ImportDeclaration:
            // ES6: 15.2.1 valid import declarations:
            //     - import ImportClause FromClause ;
            //     - import ModuleSpecifier ;
            // If no ImportClause is present,
            // this should be `import ModuleSpecifier` so skip `from`
            //
            // ModuleSpecifier is StringLiteral.
            if (stmt.specifiers.length === 0) {
                // import ModuleSpecifier ;
                result = [
                    'import',
                    space,
                    generateLiteral(stmt.source)
                ];
            } else {
                // import ImportClause FromClause ;
                if (stmt.kind === 'default') {
                    // import ... from "...";
                    result = [
                        'import',
                        noEmptySpace(),
                        stmt.specifiers[0].id.name,
                        noEmptySpace()
                    ];
                } else {
                    // stmt.kind === 'named'
                    result = [
                        'import',
                        space,
                        '{'
                    ];

                    if (stmt.specifiers.length === 1) {
                        // import { ... } from "...";
                        specifier = stmt.specifiers[0];
                        result.push(space + specifier.id.name);
                        if (specifier.name) {
                            result.push(noEmptySpace() + 'as' + noEmptySpace() + specifier.name.name);
                        }
                        result.push(space + '}' + space);
                    } else {
                        // import {
                        //    ...,
                        //    ...,
                        // } from "...";
                        withIndent(function (indent) {
                            var i, iz;
                            result.push(newline);
                            for (i = 0, iz = stmt.specifiers.length; i < iz; ++i) {
                                specifier = stmt.specifiers[i];
                                result.push(indent + specifier.id.name);
                                if (specifier.name) {
                                    result.push(noEmptySpace() + 'as' + noEmptySpace() + specifier.name.name);
                                }

                                if (i + 1 < iz) {
                                    result.push(',' + newline);
                                }
                            }
                        });
                        if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                            result.push(newline);
                        }
                        result.push(base + '}' + space);
                    }
                }

                result.push('from' + space);
                result.push(generateLiteral(stmt.source));
            }
            result.push(semicolon);
            break;

        case Syntax.VariableDeclarator:
            if (stmt.init) {
                result = [
                    generateExpression(stmt.id, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space,
                    '=',
                    space,
                    generateExpression(stmt.init, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ];
            } else {
                result = generatePattern(stmt.id, {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn
                });
            }
            break;

        case Syntax.VariableDeclaration:
            // VariableDeclarator is typed as Statement,
            // but joined with comma (not LineTerminator).
            // So if comment is attached to target node, we should specialize.
            result = generateVariableDeclaration(stmt, semicolon, allowIn);
            break;

        case Syntax.ThrowStatement:
            result = [join(
                'throw',
                generateExpression(stmt.argument, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), semicolon];
            break;

        case Syntax.TryStatement:
            result = ['try', maybeBlock(stmt.block)];
            result = maybeBlockSuffix(stmt.block, result);

            if (stmt.handlers) {
                // old interface
                for (i = 0, len = stmt.handlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.handlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                guardedHandlers = stmt.guardedHandlers || [];

                for (i = 0, len = guardedHandlers.length; i < len; ++i) {
                    result = join(result, generateStatement(guardedHandlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(guardedHandlers[i].body, result);
                    }
                }

                // new interface
                if (stmt.handler) {
                    if (isArray(stmt.handler)) {
                        for (i = 0, len = stmt.handler.length; i < len; ++i) {
                            result = join(result, generateStatement(stmt.handler[i]));
                            if (stmt.finalizer || i + 1 !== len) {
                                result = maybeBlockSuffix(stmt.handler[i].body, result);
                            }
                        }
                    } else {
                        result = join(result, generateStatement(stmt.handler));
                        if (stmt.finalizer) {
                            result = maybeBlockSuffix(stmt.handler.body, result);
                        }
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', maybeBlock(stmt.finalizer)]);
            }
            break;

        case Syntax.SwitchStatement:
            withIndent(function () {
                result = [
                    'switch' + space + '(',
                    generateExpression(stmt.discriminant, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')' + space + '{' + newline
                ];
            });
            if (stmt.cases) {
                for (i = 0, len = stmt.cases.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.cases[i], {semicolonOptional: i === len - 1}));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            break;

        case Syntax.SwitchCase:
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', generateExpression(stmt.test, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        })),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                i = 0;
                len = stmt.consequent.length;
                if (len && stmt.consequent[0].type === Syntax.BlockStatement) {
                    fragment = maybeBlock(stmt.consequent[0]);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push(newline);
                }

                for (; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.consequent[i], {semicolonOptional: i === len - 1 && semicolon === ''}));
                    result.push(fragment);
                    if (i + 1 !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            break;

        case Syntax.IfStatement:
            withIndent(function () {
                result = [
                    'if' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            if (stmt.alternate) {
                result.push(maybeBlock(stmt.consequent));
                result = maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', generateStatement(stmt.alternate, {semicolonOptional: semicolon === ''})]);
                } else {
                    result = join(result, join('else', maybeBlock(stmt.alternate, semicolon === '')));
                }
            } else {
                result.push(maybeBlock(stmt.consequent, semicolon === ''));
            }
            break;

        case Syntax.ForStatement:
            withIndent(function () {
                result = ['for' + space + '('];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(generateStatement(stmt.init, {allowIn: false}));
                    } else {
                        result.push(generateExpression(stmt.init, {
                            precedence: Precedence.Sequence,
                            allowIn: false,
                            allowCall: true
                        }));
                        result.push(';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space);
                    result.push(generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space);
                    result.push(generateExpression(stmt.update, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(')');
                } else {
                    result.push(')');
                }
            });

            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.ForInStatement:
            result = generateIterationForStatement('in', stmt, semicolon === '');
            break;

        case Syntax.ForOfStatement:
            result = generateIterationForStatement('of', stmt, semicolon === '');
            break;

        case Syntax.LabeledStatement:
            result = [stmt.label.name + ':', maybeBlock(stmt.body, semicolon === '')];
            break;

        case Syntax.Program:
            len = stmt.body.length;
            result = [safeConcatenation && len > 0 ? '\n' : ''];
            for (i = 0; i < len; ++i) {
                fragment = addIndent(
                    generateStatement(stmt.body[i], {
                        semicolonOptional: !safeConcatenation && i === len - 1,
                        directiveContext: true
                    })
                );
                result.push(fragment);
                if (i + 1 < len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result.push(newline);
                }
            }
            break;

        case Syntax.FunctionDeclaration:
            isGenerator = stmt.generator && !extra.moz.starlessGenerator;
            result = [
                (isGenerator ? 'function*' : 'function'),
                (isGenerator ? space : noEmptySpace()),
                generateIdentifier(stmt.id),
                generateFunctionBody(stmt)
            ];
            break;

        case Syntax.ReturnStatement:
            if (stmt.argument) {
                result = [join(
                    'return',
                    generateExpression(stmt.argument, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    })
                ), semicolon];
            } else {
                result = ['return' + semicolon];
            }
            break;

        case Syntax.WhileStatement:
            withIndent(function () {
                result = [
                    'while' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.WithStatement:
            withIndent(function () {
                result = [
                    'with' + space + '(',
                    generateExpression(stmt.object, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        default:
            throw new Error('Unknown statement type: ' + stmt.type);
        }

        // Attach comments

        if (extra.comment) {
            result = addComments(stmt, result);
        }

        fragment = toSourceNodeWhenNeeded(result).toString();
        if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
            result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
        }

        return toSourceNodeWhenNeeded(result, stmt);
    }

    function generate(node, options) {
        var defaultOptions = getDefaultOptions(), result, pair;

        if (options != null) {
            // Obsolete options
            //
            //   `options.indent`
            //   `options.base`
            //
            // Instead of them, we can use `option.format.indent`.
            if (typeof options.indent === 'string') {
                defaultOptions.format.indent.style = options.indent;
            }
            if (typeof options.base === 'number') {
                defaultOptions.format.indent.base = options.base;
            }
            options = updateDeeply(defaultOptions, options);
            indent = options.format.indent.style;
            if (typeof options.base === 'string') {
                base = options.base;
            } else {
                base = stringRepeat(indent, options.format.indent.base);
            }
        } else {
            options = defaultOptions;
            indent = options.format.indent.style;
            base = stringRepeat(indent, options.format.indent.base);
        }
        json = options.format.json;
        renumber = options.format.renumber;
        hexadecimal = json ? false : options.format.hexadecimal;
        quotes = json ? 'double' : options.format.quotes;
        escapeless = options.format.escapeless;
        newline = options.format.newline;
        space = options.format.space;
        if (options.format.compact) {
            newline = space = indent = base = '';
        }
        parentheses = options.format.parentheses;
        semicolons = options.format.semicolons;
        safeConcatenation = options.format.safeConcatenation;
        directive = options.directive;
        parse = json ? null : options.parse;
        sourceMap = options.sourceMap;
        extra = options;

        if (sourceMap) {
            if (!exports.browser) {
                // We assume environment is node.js
                // And prevent from including source-map by browserify
                SourceNode = require('source-map').SourceNode;
            } else {
                SourceNode = global.sourceMap.SourceNode;
            }
        }

        switch (node.type) {
        case Syntax.BlockStatement:
        case Syntax.BreakStatement:
        case Syntax.CatchClause:
        case Syntax.ContinueStatement:
        case Syntax.DirectiveStatement:
        case Syntax.DoWhileStatement:
        case Syntax.DebuggerStatement:
        case Syntax.EmptyStatement:
        case Syntax.ExpressionStatement:
        case Syntax.ForStatement:
        case Syntax.ForInStatement:
        case Syntax.ForOfStatement:
        case Syntax.FunctionDeclaration:
        case Syntax.IfStatement:
        case Syntax.LabeledStatement:
        case Syntax.Program:
        case Syntax.ReturnStatement:
        case Syntax.SwitchStatement:
        case Syntax.SwitchCase:
        case Syntax.ThrowStatement:
        case Syntax.TryStatement:
        case Syntax.VariableDeclaration:
        case Syntax.VariableDeclarator:
        case Syntax.WhileStatement:
        case Syntax.WithStatement:
            result = generateStatement(node);
            break;

        case Syntax.AssignmentExpression:
        case Syntax.ArrayExpression:
        case Syntax.ArrayPattern:
        case Syntax.BinaryExpression:
        case Syntax.CallExpression:
        case Syntax.ConditionalExpression:
        case Syntax.FunctionExpression:
        case Syntax.Identifier:
        case Syntax.Literal:
        case Syntax.LogicalExpression:
        case Syntax.MemberExpression:
        case Syntax.NewExpression:
        case Syntax.ObjectExpression:
        case Syntax.ObjectPattern:
        case Syntax.Property:
        case Syntax.SequenceExpression:
        case Syntax.ThisExpression:
        case Syntax.UnaryExpression:
        case Syntax.UpdateExpression:
        case Syntax.YieldExpression:

            result = generateExpression(node, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            });
            break;

        default:
            throw new Error('Unknown node type: ' + node.type);
        }

        if (!sourceMap) {
            pair = {code: result.toString(), map: null};
            return options.sourceMapWithCode ? pair : pair.code;
        }


        pair = result.toStringWithSourceMap({
            file: options.file,
            sourceRoot: options.sourceMapRoot
        });

        if (options.sourceContent) {
            pair.map.setSourceContent(options.sourceMap,
                                      options.sourceContent);
        }

        if (options.sourceMapWithCode) {
            return pair;
        }

        return pair.map.toString();
    }

    FORMAT_MINIFY = {
        indent: {
            style: '',
            base: 0
        },
        renumber: true,
        hexadecimal: true,
        quotes: 'auto',
        escapeless: true,
        compact: true,
        parentheses: false,
        semicolons: false
    };

    FORMAT_DEFAULTS = getDefaultOptions().format;

    exports.version = require('./package.json').version;
    exports.generate = generate;
    exports.attachComments = estraverse.attachComments;
    exports.Precedence = updateDeeply({}, Precedence);
    exports.browser = false;
    exports.FORMAT_MINIFY = FORMAT_MINIFY;
    exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
}());
/* vim: set sw=4 ts=4 et tw=80 : */

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./package.json":4,"estraverse":6,"esutils":10,"source-map":11}],4:[function(require,module,exports){
module.exports={
  "name": "escodegen",
  "description": "ECMAScript code generator",
  "homepage": "http://github.com/Constellation/escodegen",
  "main": "escodegen.js",
  "bin": {
    "esgenerate": "./bin/esgenerate.js",
    "escodegen": "./bin/escodegen.js"
  },
  "version": "1.3.4-dev",
  "engines": {
    "node": ">=0.10.0"
  },
  "maintainers": [
    {
      "name": "Yusuke Suzuki",
      "email": "utatane.tea@gmail.com",
      "web": "http://github.com/Constellation"
    }
  ],
  "repository": {
    "type": "git",
    "url": "http://github.com/Constellation/escodegen.git"
  },
  "dependencies": {
    "estraverse": "^1.5.1",
    "esutils": "^1.1.4",
    "esprima": "^1.2.2"
  },
  "optionalDependencies": {
    "source-map": "~0.1.37"
  },
  "devDependencies": {
    "esprima-moz": "*",
    "semver": "^3.0.1",
    "bluebird": "^2.2.2",
    "jshint-stylish": "^0.4.0",
    "chai": "^1.9.1",
    "gulp-mocha": "^0.5.2",
    "gulp-eslint": "^0.1.8",
    "gulp": "^3.8.6",
    "bower-registry-client": "^0.2.1",
    "gulp-jshint": "^1.8.0",
    "commonjs-everywhere": "^0.9.7"
  },
  "licenses": [
    {
      "type": "BSD",
      "url": "http://github.com/Constellation/escodegen/raw/master/LICENSE.BSD"
    }
  ],
  "scripts": {
    "test": "gulp travis",
    "unit-test": "gulp test",
    "lint": "gulp lint",
    "release": "node tools/release.js",
    "build-min": "./node_modules/.bin/cjsify -ma path: tools/entry-point.js > escodegen.browser.min.js",
    "build": "./node_modules/.bin/cjsify -a path: tools/entry-point.js > escodegen.browser.js"
  }
}

},{}],5:[function(require,module,exports){
/*
  Copyright (C) 2013 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2013 Thaddee Tyl <thaddee.tyl@gmail.com>
  Copyright (C) 2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>
  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint bitwise:true plusplus:true */
/*global esprima:true, define:true, exports:true, window: true,
throwErrorTolerant: true,
throwError: true, generateStatement: true, peek: true,
parseAssignmentExpression: true, parseBlock: true, parseExpression: true,
parseFunctionDeclaration: true, parseFunctionExpression: true,
parseFunctionSourceElements: true, parseVariableIdentifier: true,
parseLeftHandSideExpression: true, parseParams: true, validateParam: true,
parseUnaryExpression: true,
parseStatement: true, parseSourceElement: true */

(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // Rhino, and plain browser loading.

    /* istanbul ignore next */
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.esprima = {}));
    }
}(this, function (exports) {
    'use strict';

    var Token,
        TokenName,
        FnExprTokens,
        Syntax,
        PlaceHolders,
        PropertyKind,
        Messages,
        Regex,
        source,
        strict,
        index,
        lineNumber,
        lineStart,
        length,
        lookahead,
        state,
        extra;

    Token = {
        BooleanLiteral: 1,
        EOF: 2,
        Identifier: 3,
        Keyword: 4,
        NullLiteral: 5,
        NumericLiteral: 6,
        Punctuator: 7,
        StringLiteral: 8,
        RegularExpression: 9
    };

    TokenName = {};
    TokenName[Token.BooleanLiteral] = 'Boolean';
    TokenName[Token.EOF] = '<end>';
    TokenName[Token.Identifier] = 'Identifier';
    TokenName[Token.Keyword] = 'Keyword';
    TokenName[Token.NullLiteral] = 'Null';
    TokenName[Token.NumericLiteral] = 'Numeric';
    TokenName[Token.Punctuator] = 'Punctuator';
    TokenName[Token.StringLiteral] = 'String';
    TokenName[Token.RegularExpression] = 'RegularExpression';

    // A function following one of those tokens is an expression.
    FnExprTokens = ['(', '{', '[', 'in', 'typeof', 'instanceof', 'new',
                    'return', 'case', 'delete', 'throw', 'void',
                    // assignment operators
                    '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '>>>=',
                    '&=', '|=', '^=', ',',
                    // binary/unary operators
                    '+', '-', '*', '/', '%', '++', '--', '<<', '>>', '>>>', '&',
                    '|', '^', '!', '~', '&&', '||', '?', ':', '===', '==', '>=',
                    '<=', '<', '>', '!=', '!=='];

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement'
    };

    PlaceHolders = {
        ArrowParameterPlaceHolder: {
            type: 'ArrowParameterPlaceHolder'
        }
    };

    PropertyKind = {
        Data: 1,
        Get: 2,
        Set: 4
    };

    // Error messages should be identical to V8.
    Messages = {
        UnexpectedToken:  'Unexpected token %0',
        UnexpectedNumber:  'Unexpected number',
        UnexpectedString:  'Unexpected string',
        UnexpectedIdentifier:  'Unexpected identifier',
        UnexpectedReserved:  'Unexpected reserved word',
        UnexpectedEOS:  'Unexpected end of input',
        NewlineAfterThrow:  'Illegal newline after throw',
        InvalidRegExp: 'Invalid regular expression',
        UnterminatedRegExp:  'Invalid regular expression: missing /',
        InvalidLHSInAssignment:  'Invalid left-hand side in assignment',
        InvalidLHSInForIn:  'Invalid left-hand side in for-in',
        MultipleDefaultsInSwitch: 'More than one default clause in switch statement',
        NoCatchOrFinally:  'Missing catch or finally after try',
        UnknownLabel: 'Undefined label \'%0\'',
        Redeclaration: '%0 \'%1\' has already been declared',
        IllegalContinue: 'Illegal continue statement',
        IllegalBreak: 'Illegal break statement',
        IllegalReturn: 'Illegal return statement',
        StrictModeWith:  'Strict mode code may not include a with statement',
        StrictCatchVariable:  'Catch variable may not be eval or arguments in strict mode',
        StrictVarName:  'Variable name may not be eval or arguments in strict mode',
        StrictParamName:  'Parameter name eval or arguments is not allowed in strict mode',
        StrictParamDupe: 'Strict mode function may not have duplicate parameter names',
        StrictFunctionName:  'Function name may not be eval or arguments in strict mode',
        StrictOctalLiteral:  'Octal literals are not allowed in strict mode.',
        StrictDelete:  'Delete of an unqualified identifier in strict mode.',
        StrictDuplicateProperty:  'Duplicate data property in object literal not allowed in strict mode',
        AccessorDataProperty:  'Object literal may not have data and accessor property with the same name',
        AccessorGetSet:  'Object literal may not have multiple get/set accessors with the same name',
        StrictLHSAssignment:  'Assignment to eval or arguments is not allowed in strict mode',
        StrictLHSPostfix:  'Postfix increment/decrement may not have eval or arguments operand in strict mode',
        StrictLHSPrefix:  'Prefix increment/decrement may not have eval or arguments operand in strict mode',
        StrictReservedWord:  'Use of future reserved word in strict mode'
    };

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B2\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
        NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B2\u08E4-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA69D\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2D\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
    };

    // Ensure the condition is true, otherwise throw an error.
    // This is only to have a better contract semantic, i.e. another safety net
    // to catch a logic error. The condition shall be fulfilled in normal case.
    // Do NOT use this to enforce a certain condition on any user input.

    function assert(condition, message) {
        /* istanbul ignore if */
        if (!condition) {
            throw new Error('ASSERT: ' + message);
        }
    }

    function isDecimalDigit(ch) {
        return (ch >= 0x30 && ch <= 0x39);   // 0..9
    }

    function isHexDigit(ch) {
        return '0123456789abcdefABCDEF'.indexOf(ch) >= 0;
    }

    function isOctalDigit(ch) {
        return '01234567'.indexOf(ch) >= 0;
    }


    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 0x20) || (ch === 0x09) || (ch === 0x0B) || (ch === 0x0C) || (ch === 0xA0) ||
            (ch >= 0x1680 && [0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF].indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 0x0A) || (ch === 0x0D) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 0x24) || (ch === 0x5F) ||  // $ (dollar) and _ (underscore)
            (ch >= 0x41 && ch <= 0x5A) ||         // A..Z
            (ch >= 0x61 && ch <= 0x7A) ||         // a..z
            (ch === 0x5C) ||                      // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 0x24) || (ch === 0x5F) ||  // $ (dollar) and _ (underscore)
            (ch >= 0x41 && ch <= 0x5A) ||         // A..Z
            (ch >= 0x61 && ch <= 0x7A) ||         // a..z
            (ch >= 0x30 && ch <= 0x39) ||         // 0..9
            (ch === 0x5C) ||                      // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    // 7.6.1.2 Future Reserved Words

    function isFutureReservedWord(id) {
        switch (id) {
        case 'class':
        case 'enum':
        case 'export':
        case 'extends':
        case 'import':
        case 'super':
            return true;
        default:
            return false;
        }
    }

    function isStrictModeReservedWord(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'yield':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    // 7.6.1.1 Keywords

    function isKeyword(id) {
        if (strict && isStrictModeReservedWord(id)) {
            return true;
        }

        // 'const' is specialized as Keyword in V8.
        // 'yield' and 'let' are for compatiblity with SpiderMonkey and ES.next.
        // Some others are from future reserved words.

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') ||
                (id === 'try') || (id === 'let');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    // 7.4 Comments

    function addComment(type, value, start, end, loc) {
        var comment;

        assert(typeof start === 'number', 'Comment must have valid position');

        // Because the way the actual token is scanned, often the comments
        // (if any) are skipped twice during the lexical analysis.
        // Thus, we need to skip adding a comment if the comment array already
        // handled it.
        if (state.lastCommentStart >= start) {
            return;
        }
        state.lastCommentStart = start;

        comment = {
            type: type,
            value: value
        };
        if (extra.range) {
            comment.range = [start, end];
        }
        if (extra.loc) {
            comment.loc = loc;
        }
        extra.comments.push(comment);
        if (extra.attachComment) {
            extra.leadingComments.push(comment);
            extra.trailingComments.push(comment);
        }
    }

    function skipSingleLineComment(offset) {
        var start, loc, ch, comment;

        start = index - offset;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart - offset
            }
        };

        while (index < length) {
            ch = source.charCodeAt(index);
            ++index;
            if (isLineTerminator(ch)) {
                if (extra.comments) {
                    comment = source.slice(start + offset, index - 1);
                    loc.end = {
                        line: lineNumber,
                        column: index - lineStart - 1
                    };
                    addComment('Line', comment, start, index - 1, loc);
                }
                if (ch === 13 && source.charCodeAt(index) === 10) {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
                return;
            }
        }

        if (extra.comments) {
            comment = source.slice(start + offset, index);
            loc.end = {
                line: lineNumber,
                column: index - lineStart
            };
            addComment('Line', comment, start, index, loc);
        }
    }

    function skipMultiLineComment() {
        var start, loc, ch, comment;

        if (extra.comments) {
            start = index - 2;
            loc = {
                start: {
                    line: lineNumber,
                    column: index - lineStart - 2
                }
            };
        }

        while (index < length) {
            ch = source.charCodeAt(index);
            if (isLineTerminator(ch)) {
                if (ch === 0x0D && source.charCodeAt(index + 1) === 0x0A) {
                    ++index;
                }
                ++lineNumber;
                ++index;
                lineStart = index;
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else if (ch === 0x2A) {
                // Block comment ends with '*/'.
                if (source.charCodeAt(index + 1) === 0x2F) {
                    ++index;
                    ++index;
                    if (extra.comments) {
                        comment = source.slice(start + 2, index - 2);
                        loc.end = {
                            line: lineNumber,
                            column: index - lineStart
                        };
                        addComment('Block', comment, start, index, loc);
                    }
                    return;
                }
                ++index;
            } else {
                ++index;
            }
        }

        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }

    function skipComment() {
        var ch, start;

        start = (index === 0);
        while (index < length) {
            ch = source.charCodeAt(index);

            if (isWhiteSpace(ch)) {
                ++index;
            } else if (isLineTerminator(ch)) {
                ++index;
                if (ch === 0x0D && source.charCodeAt(index) === 0x0A) {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
                start = true;
            } else if (ch === 0x2F) { // U+002F is '/'
                ch = source.charCodeAt(index + 1);
                if (ch === 0x2F) {
                    ++index;
                    ++index;
                    skipSingleLineComment(2);
                    start = true;
                } else if (ch === 0x2A) {  // U+002A is '*'
                    ++index;
                    ++index;
                    skipMultiLineComment();
                } else {
                    break;
                }
            } else if (start && ch === 0x2D) { // U+002D is '-'
                // U+003E is '>'
                if ((source.charCodeAt(index + 1) === 0x2D) && (source.charCodeAt(index + 2) === 0x3E)) {
                    // '-->' is a single-line comment
                    index += 3;
                    skipSingleLineComment(3);
                } else {
                    break;
                }
            } else if (ch === 0x3C) { // U+003C is '<'
                if (source.slice(index + 1, index + 4) === '!--') {
                    ++index; // `<`
                    ++index; // `!`
                    ++index; // `-`
                    ++index; // `-`
                    skipSingleLineComment(4);
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    function scanHexEscape(prefix) {
        var i, len, ch, code = 0;

        len = (prefix === 'u') ? 4 : 2;
        for (i = 0; i < len; ++i) {
            if (index < length && isHexDigit(source[index])) {
                ch = source[index++];
                code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
            } else {
                return '';
            }
        }
        return String.fromCharCode(code);
    }

    function scanUnicodeCodePointEscape() {
        var ch, code, cu1, cu2;

        ch = source[index];
        code = 0;

        // At least, one hex digit is required.
        if (ch === '}') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        while (index < length) {
            ch = source[index++];
            if (!isHexDigit(ch)) {
                break;
            }
            code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
        }

        if (code > 0x10FFFF || ch !== '}') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        // UTF-16 Encoding
        if (code <= 0xFFFF) {
            return String.fromCharCode(code);
        }
        cu1 = ((code - 0x10000) >> 10) + 0xD800;
        cu2 = ((code - 0x10000) & 1023) + 0xDC00;
        return String.fromCharCode(cu1, cu2);
    }

    function getEscapedIdentifier() {
        var ch, id;

        ch = source.charCodeAt(index++);
        id = String.fromCharCode(ch);

        // '\u' (U+005C, U+0075) denotes an escaped character.
        if (ch === 0x5C) {
            if (source.charCodeAt(index) !== 0x75) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            ++index;
            ch = scanHexEscape('u');
            if (!ch || ch === '\\' || !isIdentifierStart(ch.charCodeAt(0))) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            id = ch;
        }

        while (index < length) {
            ch = source.charCodeAt(index);
            if (!isIdentifierPart(ch)) {
                break;
            }
            ++index;
            id += String.fromCharCode(ch);

            // '\u' (U+005C, U+0075) denotes an escaped character.
            if (ch === 0x5C) {
                id = id.substr(0, id.length - 1);
                if (source.charCodeAt(index) !== 0x75) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                ++index;
                ch = scanHexEscape('u');
                if (!ch || ch === '\\' || !isIdentifierPart(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                id += ch;
            }
        }

        return id;
    }

    function getIdentifier() {
        var start, ch;

        start = index++;
        while (index < length) {
            ch = source.charCodeAt(index);
            if (ch === 0x5C) {
                // Blackslash (U+005C) marks Unicode escape sequence.
                index = start;
                return getEscapedIdentifier();
            }
            if (isIdentifierPart(ch)) {
                ++index;
            } else {
                break;
            }
        }

        return source.slice(start, index);
    }

    function scanIdentifier() {
        var start, id, type;

        start = index;

        // Backslash (U+005C) starts an escaped character.
        id = (source.charCodeAt(index) === 0x5C) ? getEscapedIdentifier() : getIdentifier();

        // There is no keyword or literal with only one character.
        // Thus, it must be an identifier.
        if (id.length === 1) {
            type = Token.Identifier;
        } else if (isKeyword(id)) {
            type = Token.Keyword;
        } else if (id === 'null') {
            type = Token.NullLiteral;
        } else if (id === 'true' || id === 'false') {
            type = Token.BooleanLiteral;
        } else {
            type = Token.Identifier;
        }

        return {
            type: type,
            value: id,
            lineNumber: lineNumber,
            lineStart: lineStart,
            start: start,
            end: index
        };
    }


    // 7.7 Punctuators

    function scanPunctuator() {
        var start = index,
            code = source.charCodeAt(index),
            code2,
            ch1 = source[index],
            ch2,
            ch3,
            ch4;

        switch (code) {

        // Check for most common single-character punctuators.
        case 0x2E:  // . dot
        case 0x28:  // ( open bracket
        case 0x29:  // ) close bracket
        case 0x3B:  // ; semicolon
        case 0x2C:  // , comma
        case 0x7B:  // { open curly brace
        case 0x7D:  // } close curly brace
        case 0x5B:  // [
        case 0x5D:  // ]
        case 0x3A:  // :
        case 0x3F:  // ?
        case 0x7E:  // ~
            ++index;
            if (extra.tokenize) {
                if (code === 0x28) {
                    extra.openParenToken = extra.tokens.length;
                } else if (code === 0x7B) {
                    extra.openCurlyToken = extra.tokens.length;
                }
            }
            return {
                type: Token.Punctuator,
                value: String.fromCharCode(code),
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: start,
                end: index
            };

        default:
            code2 = source.charCodeAt(index + 1);

            // '=' (U+003D) marks an assignment or comparison operator.
            if (code2 === 0x3D) {
                switch (code) {
                case 0x2B:  // +
                case 0x2D:  // -
                case 0x2F:  // /
                case 0x3C:  // <
                case 0x3E:  // >
                case 0x5E:  // ^
                case 0x7C:  // |
                case 0x25:  // %
                case 0x26:  // &
                case 0x2A:  // *
                    index += 2;
                    return {
                        type: Token.Punctuator,
                        value: String.fromCharCode(code) + String.fromCharCode(code2),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        start: start,
                        end: index
                    };

                case 0x21: // !
                case 0x3D: // =
                    index += 2;

                    // !== and ===
                    if (source.charCodeAt(index) === 0x3D) {
                        ++index;
                    }
                    return {
                        type: Token.Punctuator,
                        value: source.slice(start, index),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        start: start,
                        end: index
                    };
                }
            }
        }

        // 4-character punctuator: >>>=

        ch4 = source.substr(index, 4);

        if (ch4 === '>>>=') {
            index += 4;
            return {
                type: Token.Punctuator,
                value: ch4,
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: start,
                end: index
            };
        }

        // 3-character punctuators: === !== >>> <<= >>=

        ch3 = ch4.substr(0, 3);

        if (ch3 === '>>>' || ch3 === '<<=' || ch3 === '>>=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: ch3,
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: start,
                end: index
            };
        }

        // Other 2-character punctuators: ++ -- << >> && ||
        ch2 = ch3.substr(0, 2);

        if ((ch1 === ch2[1] && ('+-<>&|'.indexOf(ch1) >= 0)) || ch2 === '=>') {
            index += 2;
            return {
                type: Token.Punctuator,
                value: ch2,
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: start,
                end: index
            };
        }

        // 1-character punctuators: < > = ! + - * % & | ^ /

        if ('<>=!+-*%&|^/'.indexOf(ch1) >= 0) {
            ++index;
            return {
                type: Token.Punctuator,
                value: ch1,
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: start,
                end: index
            };
        }

        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }

    // 7.8.3 Numeric Literals

    function scanHexLiteral(start) {
        var number = '';

        while (index < length) {
            if (!isHexDigit(source[index])) {
                break;
            }
            number += source[index++];
        }

        if (number.length === 0) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        if (isIdentifierStart(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseInt('0x' + number, 16),
            lineNumber: lineNumber,
            lineStart: lineStart,
            start: start,
            end: index
        };
    }

    function scanOctalLiteral(start) {
        var number = '0' + source[index++];
        while (index < length) {
            if (!isOctalDigit(source[index])) {
                break;
            }
            number += source[index++];
        }

        if (isIdentifierStart(source.charCodeAt(index)) || isDecimalDigit(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseInt(number, 8),
            octal: true,
            lineNumber: lineNumber,
            lineStart: lineStart,
            start: start,
            end: index
        };
    }

    function scanNumericLiteral() {
        var number, start, ch;

        ch = source[index];
        assert(isDecimalDigit(ch.charCodeAt(0)) || (ch === '.'),
            'Numeric literal must start with a decimal digit or a decimal point');

        start = index;
        number = '';
        if (ch !== '.') {
            number = source[index++];
            ch = source[index];

            // Hex number starts with '0x'.
            // Octal number starts with '0'.
            if (number === '0') {
                if (ch === 'x' || ch === 'X') {
                    ++index;
                    return scanHexLiteral(start);
                }
                if (isOctalDigit(ch)) {
                    return scanOctalLiteral(start);
                }

                // decimal number starts with '0' such as '09' is illegal.
                if (ch && isDecimalDigit(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            }

            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
            ch = source[index];
        }

        if (ch === '.') {
            number += source[index++];
            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
            ch = source[index];
        }

        if (ch === 'e' || ch === 'E') {
            number += source[index++];

            ch = source[index];
            if (ch === '+' || ch === '-') {
                number += source[index++];
            }
            if (isDecimalDigit(source.charCodeAt(index))) {
                while (isDecimalDigit(source.charCodeAt(index))) {
                    number += source[index++];
                }
            } else {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
        }

        if (isIdentifierStart(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseFloat(number),
            lineNumber: lineNumber,
            lineStart: lineStart,
            start: start,
            end: index
        };
    }

    // 7.8.4 String Literals

    function scanStringLiteral() {
        var str = '', quote, start, ch, code, unescaped, restore, octal = false, startLineNumber, startLineStart;
        startLineNumber = lineNumber;
        startLineStart = lineStart;

        quote = source[index];
        assert((quote === '\'' || quote === '"'),
            'String literal must starts with a quote');

        start = index;
        ++index;

        while (index < length) {
            ch = source[index++];

            if (ch === quote) {
                quote = '';
                break;
            } else if (ch === '\\') {
                ch = source[index++];
                if (!ch || !isLineTerminator(ch.charCodeAt(0))) {
                    switch (ch) {
                    case 'u':
                    case 'x':
                        if (source[index] === '{') {
                            ++index;
                            str += scanUnicodeCodePointEscape();
                        } else {
                            restore = index;
                            unescaped = scanHexEscape(ch);
                            if (unescaped) {
                                str += unescaped;
                            } else {
                                index = restore;
                                str += ch;
                            }
                        }
                        break;
                    case 'n':
                        str += '\n';
                        break;
                    case 'r':
                        str += '\r';
                        break;
                    case 't':
                        str += '\t';
                        break;
                    case 'b':
                        str += '\b';
                        break;
                    case 'f':
                        str += '\f';
                        break;
                    case 'v':
                        str += '\x0B';
                        break;

                    default:
                        if (isOctalDigit(ch)) {
                            code = '01234567'.indexOf(ch);

                            // \0 is not octal escape sequence
                            if (code !== 0) {
                                octal = true;
                            }

                            if (index < length && isOctalDigit(source[index])) {
                                octal = true;
                                code = code * 8 + '01234567'.indexOf(source[index++]);

                                // 3 digits are only allowed when string starts
                                // with 0, 1, 2, 3
                                if ('0123'.indexOf(ch) >= 0 &&
                                        index < length &&
                                        isOctalDigit(source[index])) {
                                    code = code * 8 + '01234567'.indexOf(source[index++]);
                                }
                            }
                            str += String.fromCharCode(code);
                        } else {
                            str += ch;
                        }
                        break;
                    }
                } else {
                    ++lineNumber;
                    if (ch ===  '\r' && source[index] === '\n') {
                        ++index;
                    }
                    lineStart = index;
                }
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                break;
            } else {
                str += ch;
            }
        }

        if (quote !== '') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.StringLiteral,
            value: str,
            octal: octal,
            startLineNumber: startLineNumber,
            startLineStart: startLineStart,
            lineNumber: lineNumber,
            lineStart: lineStart,
            start: start,
            end: index
        };
    }

    function testRegExp(pattern, flags) {
        var value;
        try {
            value = new RegExp(pattern, flags);
        } catch (e) {
            throwError({}, Messages.InvalidRegExp);
        }
        return value;
    }

    function scanRegExpBody() {
        var ch, str, classMarker, terminated, body;

        ch = source[index];
        assert(ch === '/', 'Regular expression literal must start with a slash');
        str = source[index++];

        classMarker = false;
        terminated = false;
        while (index < length) {
            ch = source[index++];
            str += ch;
            if (ch === '\\') {
                ch = source[index++];
                // ECMA-262 7.8.5
                if (isLineTerminator(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnterminatedRegExp);
                }
                str += ch;
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                throwError({}, Messages.UnterminatedRegExp);
            } else if (classMarker) {
                if (ch === ']') {
                    classMarker = false;
                }
            } else {
                if (ch === '/') {
                    terminated = true;
                    break;
                } else if (ch === '[') {
                    classMarker = true;
                }
            }
        }

        if (!terminated) {
            throwError({}, Messages.UnterminatedRegExp);
        }

        // Exclude leading and trailing slash.
        body = str.substr(1, str.length - 2);
        return {
            value: body,
            literal: str
        };
    }

    function scanRegExpFlags() {
        var ch, str, flags, restore;

        str = '';
        flags = '';
        while (index < length) {
            ch = source[index];
            if (!isIdentifierPart(ch.charCodeAt(0))) {
                break;
            }

            ++index;
            if (ch === '\\' && index < length) {
                ch = source[index];
                if (ch === 'u') {
                    ++index;
                    restore = index;
                    ch = scanHexEscape('u');
                    if (ch) {
                        flags += ch;
                        for (str += '\\u'; restore < index; ++restore) {
                            str += source[restore];
                        }
                    } else {
                        index = restore;
                        flags += 'u';
                        str += '\\u';
                    }
                    throwErrorTolerant({}, Messages.UnexpectedToken, 'ILLEGAL');
                } else {
                    str += '\\';
                    throwErrorTolerant({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else {
                flags += ch;
                str += ch;
            }
        }

        return {
            value: flags,
            literal: str
        };
    }

    function scanRegExp() {
        var start, body, flags, value;

        lookahead = null;
        skipComment();
        start = index;

        body = scanRegExpBody();
        flags = scanRegExpFlags();
        value = testRegExp(body.value, flags.value);

        if (extra.tokenize) {
            return {
                type: Token.RegularExpression,
                value: value,
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: start,
                end: index
            };
        }

        return {
            literal: body.literal + flags.literal,
            value: value,
            start: start,
            end: index
        };
    }

    function collectRegex() {
        var pos, loc, regex, token;

        skipComment();

        pos = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        regex = scanRegExp();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        /* istanbul ignore next */
        if (!extra.tokenize) {
            // Pop the previous token, which is likely '/' or '/='
            if (extra.tokens.length > 0) {
                token = extra.tokens[extra.tokens.length - 1];
                if (token.range[0] === pos && token.type === 'Punctuator') {
                    if (token.value === '/' || token.value === '/=') {
                        extra.tokens.pop();
                    }
                }
            }

            extra.tokens.push({
                type: 'RegularExpression',
                value: regex.literal,
                range: [pos, index],
                loc: loc
            });
        }

        return regex;
    }

    function isIdentifierName(token) {
        return token.type === Token.Identifier ||
            token.type === Token.Keyword ||
            token.type === Token.BooleanLiteral ||
            token.type === Token.NullLiteral;
    }

    function advanceSlash() {
        var prevToken,
            checkToken;
        // Using the following algorithm:
        // https://github.com/mozilla/sweet.js/wiki/design
        prevToken = extra.tokens[extra.tokens.length - 1];
        if (!prevToken) {
            // Nothing before that: it cannot be a division.
            return collectRegex();
        }
        if (prevToken.type === 'Punctuator') {
            if (prevToken.value === ']') {
                return scanPunctuator();
            }
            if (prevToken.value === ')') {
                checkToken = extra.tokens[extra.openParenToken - 1];
                if (checkToken &&
                        checkToken.type === 'Keyword' &&
                        (checkToken.value === 'if' ||
                         checkToken.value === 'while' ||
                         checkToken.value === 'for' ||
                         checkToken.value === 'with')) {
                    return collectRegex();
                }
                return scanPunctuator();
            }
            if (prevToken.value === '}') {
                // Dividing a function by anything makes little sense,
                // but we have to check for that.
                if (extra.tokens[extra.openCurlyToken - 3] &&
                        extra.tokens[extra.openCurlyToken - 3].type === 'Keyword') {
                    // Anonymous function.
                    checkToken = extra.tokens[extra.openCurlyToken - 4];
                    if (!checkToken) {
                        return scanPunctuator();
                    }
                } else if (extra.tokens[extra.openCurlyToken - 4] &&
                        extra.tokens[extra.openCurlyToken - 4].type === 'Keyword') {
                    // Named function.
                    checkToken = extra.tokens[extra.openCurlyToken - 5];
                    if (!checkToken) {
                        return collectRegex();
                    }
                } else {
                    return scanPunctuator();
                }
                // checkToken determines whether the function is
                // a declaration or an expression.
                if (FnExprTokens.indexOf(checkToken.value) >= 0) {
                    // It is an expression.
                    return scanPunctuator();
                }
                // It is a declaration.
                return collectRegex();
            }
            return collectRegex();
        }
        if (prevToken.type === 'Keyword') {
            return collectRegex();
        }
        return scanPunctuator();
    }

    function advance() {
        var ch;

        skipComment();

        if (index >= length) {
            return {
                type: Token.EOF,
                lineNumber: lineNumber,
                lineStart: lineStart,
                start: index,
                end: index
            };
        }

        ch = source.charCodeAt(index);

        if (isIdentifierStart(ch)) {
            return scanIdentifier();
        }

        // Very common: ( and ) and ;
        if (ch === 0x28 || ch === 0x29 || ch === 0x3B) {
            return scanPunctuator();
        }

        // String literal starts with single quote (U+0027) or double quote (U+0022).
        if (ch === 0x27 || ch === 0x22) {
            return scanStringLiteral();
        }


        // Dot (.) U+002E can also start a floating-point number, hence the need
        // to check the next character.
        if (ch === 0x2E) {
            if (isDecimalDigit(source.charCodeAt(index + 1))) {
                return scanNumericLiteral();
            }
            return scanPunctuator();
        }

        if (isDecimalDigit(ch)) {
            return scanNumericLiteral();
        }

        // Slash (/) U+002F can also start a regex.
        if (extra.tokenize && ch === 0x2F) {
            return advanceSlash();
        }

        return scanPunctuator();
    }

    function collectToken() {
        var loc, token, value;

        skipComment();
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        token = advance();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        if (token.type !== Token.EOF) {
            value = source.slice(token.start, token.end);
            extra.tokens.push({
                type: TokenName[token.type],
                value: value,
                range: [token.start, token.end],
                loc: loc
            });
        }

        return token;
    }

    function lex() {
        var token;

        token = lookahead;
        index = token.end;
        lineNumber = token.lineNumber;
        lineStart = token.lineStart;

        lookahead = (typeof extra.tokens !== 'undefined') ? collectToken() : advance();

        index = token.end;
        lineNumber = token.lineNumber;
        lineStart = token.lineStart;

        return token;
    }

    function peek() {
        var pos, line, start;

        pos = index;
        line = lineNumber;
        start = lineStart;
        lookahead = (typeof extra.tokens !== 'undefined') ? collectToken() : advance();
        index = pos;
        lineNumber = line;
        lineStart = start;
    }

    function Position() {
        this.line = lineNumber;
        this.column = index - lineStart;
    }

    function SourceLocation() {
        this.start = new Position();
        this.end = null;
    }

    function WrappingSourceLocation(startToken) {
        if (startToken.type === Token.StringLiteral) {
            this.start = {
                line: startToken.startLineNumber,
                column: startToken.start - startToken.startLineStart
            };
        } else {
            this.start = {
                line: startToken.lineNumber,
                column: startToken.start - startToken.lineStart
            };
        }
        this.end = null;
    }

    function Node() {
        // Skip comment.
        index = lookahead.start;
        if (lookahead.type === Token.StringLiteral) {
            lineNumber = lookahead.startLineNumber;
            lineStart = lookahead.startLineStart;
        } else {
            lineNumber = lookahead.lineNumber;
            lineStart = lookahead.lineStart;
        }
        if (extra.range) {
            this.range = [index, 0];
        }
        if (extra.loc) {
            this.loc = new SourceLocation();
        }
    }

    function WrappingNode(startToken) {
        if (extra.range) {
            this.range = [startToken.start, 0];
        }
        if (extra.loc) {
            this.loc = new WrappingSourceLocation(startToken);
        }
    }

    WrappingNode.prototype = Node.prototype = {

        processComment: function () {
            var lastChild,
                trailingComments,
                bottomRight = extra.bottomRightStack,
                last = bottomRight[bottomRight.length - 1];

            if (this.type === Syntax.Program) {
                if (this.body.length > 0) {
                    return;
                }
            }

            if (extra.trailingComments.length > 0) {
                if (extra.trailingComments[0].range[0] >= this.range[1]) {
                    trailingComments = extra.trailingComments;
                    extra.trailingComments = [];
                } else {
                    extra.trailingComments.length = 0;
                }
            } else {
                if (last && last.trailingComments && last.trailingComments[0].range[0] >= this.range[1]) {
                    trailingComments = last.trailingComments;
                    delete last.trailingComments;
                }
            }

            // Eating the stack.
            if (last) {
                while (last && last.range[0] >= this.range[0]) {
                    lastChild = last;
                    last = bottomRight.pop();
                }
            }

            if (lastChild) {
                if (lastChild.leadingComments && lastChild.leadingComments[lastChild.leadingComments.length - 1].range[1] <= this.range[0]) {
                    this.leadingComments = lastChild.leadingComments;
                    lastChild.leadingComments = undefined;
                }
            } else if (extra.leadingComments.length > 0 && extra.leadingComments[extra.leadingComments.length - 1].range[1] <= this.range[0]) {
                this.leadingComments = extra.leadingComments;
                extra.leadingComments = [];
            }


            if (trailingComments) {
                this.trailingComments = trailingComments;
            }

            bottomRight.push(this);
        },

        finish: function () {
            if (extra.range) {
                this.range[1] = index;
            }
            if (extra.loc) {
                this.loc.end = new Position();
                if (extra.source) {
                    this.loc.source = extra.source;
                }
            }

            if (extra.attachComment) {
                this.processComment();
            }
        },

        finishArrayExpression: function (elements) {
            this.type = Syntax.ArrayExpression;
            this.elements = elements;
            this.finish();
            return this;
        },

        finishArrowFunctionExpression: function (params, defaults, body, expression) {
            this.type = Syntax.ArrowFunctionExpression;
            this.id = null;
            this.params = params;
            this.defaults = defaults;
            this.body = body;
            this.rest = null;
            this.generator = false;
            this.expression = expression;
            this.finish();
            return this;
        },

        finishAssignmentExpression: function (operator, left, right) {
            this.type = Syntax.AssignmentExpression;
            this.operator = operator;
            this.left = left;
            this.right = right;
            this.finish();
            return this;
        },

        finishBinaryExpression: function (operator, left, right) {
            this.type = (operator === '||' || operator === '&&') ? Syntax.LogicalExpression : Syntax.BinaryExpression;
            this.operator = operator;
            this.left = left;
            this.right = right;
            this.finish();
            return this;
        },

        finishBlockStatement: function (body) {
            this.type = Syntax.BlockStatement;
            this.body = body;
            this.finish();
            return this;
        },

        finishBreakStatement: function (label) {
            this.type = Syntax.BreakStatement;
            this.label = label;
            this.finish();
            return this;
        },

        finishCallExpression: function (callee, args) {
            this.type = Syntax.CallExpression;
            this.callee = callee;
            this.arguments = args;
            this.finish();
            return this;
        },

        finishCatchClause: function (param, body) {
            this.type = Syntax.CatchClause;
            this.param = param;
            this.body = body;
            this.finish();
            return this;
        },

        finishConditionalExpression: function (test, consequent, alternate) {
            this.type = Syntax.ConditionalExpression;
            this.test = test;
            this.consequent = consequent;
            this.alternate = alternate;
            this.finish();
            return this;
        },

        finishContinueStatement: function (label) {
            this.type = Syntax.ContinueStatement;
            this.label = label;
            this.finish();
            return this;
        },

        finishDebuggerStatement: function () {
            this.type = Syntax.DebuggerStatement;
            this.finish();
            return this;
        },

        finishDoWhileStatement: function (body, test) {
            this.type = Syntax.DoWhileStatement;
            this.body = body;
            this.test = test;
            this.finish();
            return this;
        },

        finishEmptyStatement: function () {
            this.type = Syntax.EmptyStatement;
            this.finish();
            return this;
        },

        finishExpressionStatement: function (expression) {
            this.type = Syntax.ExpressionStatement;
            this.expression = expression;
            this.finish();
            return this;
        },

        finishForStatement: function (init, test, update, body) {
            this.type = Syntax.ForStatement;
            this.init = init;
            this.test = test;
            this.update = update;
            this.body = body;
            this.finish();
            return this;
        },

        finishForInStatement: function (left, right, body) {
            this.type = Syntax.ForInStatement;
            this.left = left;
            this.right = right;
            this.body = body;
            this.each = false;
            this.finish();
            return this;
        },

        finishFunctionDeclaration: function (id, params, defaults, body) {
            this.type = Syntax.FunctionDeclaration;
            this.id = id;
            this.params = params;
            this.defaults = defaults;
            this.body = body;
            this.rest = null;
            this.generator = false;
            this.expression = false;
            this.finish();
            return this;
        },

        finishFunctionExpression: function (id, params, defaults, body) {
            this.type = Syntax.FunctionExpression;
            this.id = id;
            this.params = params;
            this.defaults = defaults;
            this.body = body;
            this.rest = null;
            this.generator = false;
            this.expression = false;
            this.finish();
            return this;
        },

        finishIdentifier: function (name) {
            this.type = Syntax.Identifier;
            this.name = name;
            this.finish();
            return this;
        },

        finishIfStatement: function (test, consequent, alternate) {
            this.type = Syntax.IfStatement;
            this.test = test;
            this.consequent = consequent;
            this.alternate = alternate;
            this.finish();
            return this;
        },

        finishLabeledStatement: function (label, body) {
            this.type = Syntax.LabeledStatement;
            this.label = label;
            this.body = body;
            this.finish();
            return this;
        },

        finishLiteral: function (token) {
            this.type = Syntax.Literal;
            this.value = token.value;
            this.raw = source.slice(token.start, token.end);
            this.finish();
            return this;
        },

        finishMemberExpression: function (accessor, object, property) {
            this.type = Syntax.MemberExpression;
            this.computed = accessor === '[';
            this.object = object;
            this.property = property;
            this.finish();
            return this;
        },

        finishNewExpression: function (callee, args) {
            this.type = Syntax.NewExpression;
            this.callee = callee;
            this.arguments = args;
            this.finish();
            return this;
        },

        finishObjectExpression: function (properties) {
            this.type = Syntax.ObjectExpression;
            this.properties = properties;
            this.finish();
            return this;
        },

        finishPostfixExpression: function (operator, argument) {
            this.type = Syntax.UpdateExpression;
            this.operator = operator;
            this.argument = argument;
            this.prefix = false;
            this.finish();
            return this;
        },

        finishProgram: function (body) {
            this.type = Syntax.Program;
            this.body = body;
            this.finish();
            return this;
        },

        finishProperty: function (kind, key, value) {
            this.type = Syntax.Property;
            this.key = key;
            this.value = value;
            this.kind = kind;
            this.finish();
            return this;
        },

        finishReturnStatement: function (argument) {
            this.type = Syntax.ReturnStatement;
            this.argument = argument;
            this.finish();
            return this;
        },

        finishSequenceExpression: function (expressions) {
            this.type = Syntax.SequenceExpression;
            this.expressions = expressions;
            this.finish();
            return this;
        },

        finishSwitchCase: function (test, consequent) {
            this.type = Syntax.SwitchCase;
            this.test = test;
            this.consequent = consequent;
            this.finish();
            return this;
        },

        finishSwitchStatement: function (discriminant, cases) {
            this.type = Syntax.SwitchStatement;
            this.discriminant = discriminant;
            this.cases = cases;
            this.finish();
            return this;
        },

        finishThisExpression: function () {
            this.type = Syntax.ThisExpression;
            this.finish();
            return this;
        },

        finishThrowStatement: function (argument) {
            this.type = Syntax.ThrowStatement;
            this.argument = argument;
            this.finish();
            return this;
        },

        finishTryStatement: function (block, guardedHandlers, handlers, finalizer) {
            this.type = Syntax.TryStatement;
            this.block = block;
            this.guardedHandlers = guardedHandlers;
            this.handlers = handlers;
            this.finalizer = finalizer;
            this.finish();
            return this;
        },

        finishUnaryExpression: function (operator, argument) {
            this.type = (operator === '++' || operator === '--') ? Syntax.UpdateExpression : Syntax.UnaryExpression;
            this.operator = operator;
            this.argument = argument;
            this.prefix = true;
            this.finish();
            return this;
        },

        finishVariableDeclaration: function (declarations, kind) {
            this.type = Syntax.VariableDeclaration;
            this.declarations = declarations;
            this.kind = kind;
            this.finish();
            return this;
        },

        finishVariableDeclarator: function (id, init) {
            this.type = Syntax.VariableDeclarator;
            this.id = id;
            this.init = init;
            this.finish();
            return this;
        },

        finishWhileStatement: function (test, body) {
            this.type = Syntax.WhileStatement;
            this.test = test;
            this.body = body;
            this.finish();
            return this;
        },

        finishWithStatement: function (object, body) {
            this.type = Syntax.WithStatement;
            this.object = object;
            this.body = body;
            this.finish();
            return this;
        }
    };

    // Return true if there is a line terminator before the next token.

    function peekLineTerminator() {
        var pos, line, start, found;

        pos = index;
        line = lineNumber;
        start = lineStart;
        skipComment();
        found = lineNumber !== line;
        index = pos;
        lineNumber = line;
        lineStart = start;

        return found;
    }

    // Throw an exception

    function throwError(token, messageFormat) {
        var error,
            args = Array.prototype.slice.call(arguments, 2),
            msg = messageFormat.replace(
                /%(\d)/g,
                function (whole, index) {
                    assert(index < args.length, 'Message reference must be in range');
                    return args[index];
                }
            );

        if (typeof token.lineNumber === 'number') {
            error = new Error('Line ' + token.lineNumber + ': ' + msg);
            error.index = token.start;
            error.lineNumber = token.lineNumber;
            error.column = token.start - lineStart + 1;
        } else {
            error = new Error('Line ' + lineNumber + ': ' + msg);
            error.index = index;
            error.lineNumber = lineNumber;
            error.column = index - lineStart + 1;
        }

        error.description = msg;
        throw error;
    }

    function throwErrorTolerant() {
        try {
            throwError.apply(null, arguments);
        } catch (e) {
            if (extra.errors) {
                extra.errors.push(e);
            } else {
                throw e;
            }
        }
    }


    // Throw an exception because of the token.

    function throwUnexpected(token) {
        if (token.type === Token.EOF) {
            throwError(token, Messages.UnexpectedEOS);
        }

        if (token.type === Token.NumericLiteral) {
            throwError(token, Messages.UnexpectedNumber);
        }

        if (token.type === Token.StringLiteral) {
            throwError(token, Messages.UnexpectedString);
        }

        if (token.type === Token.Identifier) {
            throwError(token, Messages.UnexpectedIdentifier);
        }

        if (token.type === Token.Keyword) {
            if (isFutureReservedWord(token.value)) {
                throwError(token, Messages.UnexpectedReserved);
            } else if (strict && isStrictModeReservedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictReservedWord);
                return;
            }
            throwError(token, Messages.UnexpectedToken, token.value);
        }

        // BooleanLiteral, NullLiteral, or Punctuator.
        throwError(token, Messages.UnexpectedToken, token.value);
    }

    // Expect the next token to match the specified punctuator.
    // If not, an exception will be thrown.

    function expect(value) {
        var token = lex();
        if (token.type !== Token.Punctuator || token.value !== value) {
            throwUnexpected(token);
        }
    }

    /**
     * @name expectTolerant
     * @description Quietly expect the given token value when in tolerant mode, otherwise delegates
     * to <code>expect(value)</code>
     * @param {String} value The value we are expecting the lookahead token to have
     * @since 2.0
     */
    function expectTolerant(value) {
        if (extra.errors) {
            var token = lookahead;
            if (token.type !== Token.Punctuator && token.value !== value) {
                throwErrorTolerant(token, Messages.UnexpectedToken, token.value);
            } else {
                lex();
            }
        } else {
            expect(value);
        }
    }

    // Expect the next token to match the specified keyword.
    // If not, an exception will be thrown.

    function expectKeyword(keyword) {
        var token = lex();
        if (token.type !== Token.Keyword || token.value !== keyword) {
            throwUnexpected(token);
        }
    }

    // Return true if the next token matches the specified punctuator.

    function match(value) {
        return lookahead.type === Token.Punctuator && lookahead.value === value;
    }

    // Return true if the next token matches the specified keyword

    function matchKeyword(keyword) {
        return lookahead.type === Token.Keyword && lookahead.value === keyword;
    }

    // Return true if the next token is an assignment operator

    function matchAssign() {
        var op;

        if (lookahead.type !== Token.Punctuator) {
            return false;
        }
        op = lookahead.value;
        return op === '=' ||
            op === '*=' ||
            op === '/=' ||
            op === '%=' ||
            op === '+=' ||
            op === '-=' ||
            op === '<<=' ||
            op === '>>=' ||
            op === '>>>=' ||
            op === '&=' ||
            op === '^=' ||
            op === '|=';
    }

    function consumeSemicolon() {
        var line;

        // Catch the very common case first: immediately a semicolon (U+003B).
        if (source.charCodeAt(index) === 0x3B || match(';')) {
            lex();
            return;
        }

        line = lineNumber;
        skipComment();
        if (lineNumber !== line) {
            return;
        }

        if (lookahead.type !== Token.EOF && !match('}')) {
            throwUnexpected(lookahead);
        }
    }

    // Return true if provided expression is LeftHandSideExpression

    function isLeftHandSide(expr) {
        return expr.type === Syntax.Identifier || expr.type === Syntax.MemberExpression;
    }

    // 11.1.4 Array Initialiser

    function parseArrayInitialiser() {
        var elements = [], node = new Node();

        expect('[');

        while (!match(']')) {
            if (match(',')) {
                lex();
                elements.push(null);
            } else {
                elements.push(parseAssignmentExpression());

                if (!match(']')) {
                    expect(',');
                }
            }
        }

        lex();

        return node.finishArrayExpression(elements);
    }

    // 11.1.5 Object Initialiser

    function parsePropertyFunction(param, first) {
        var previousStrict, body, node = new Node();

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (first && strict && isRestrictedWord(param[0].name)) {
            throwErrorTolerant(first, Messages.StrictParamName);
        }
        strict = previousStrict;
        return node.finishFunctionExpression(null, param, [], body);
    }

    function parseObjectPropertyKey() {
        var token, node = new Node();

        token = lex();

        // Note: This function is called only from parseObjectProperty(), where
        // EOF and Punctuator tokens are already filtered out.

        if (token.type === Token.StringLiteral || token.type === Token.NumericLiteral) {
            if (strict && token.octal) {
                throwErrorTolerant(token, Messages.StrictOctalLiteral);
            }
            return node.finishLiteral(token);
        }

        return node.finishIdentifier(token.value);
    }

    function parseObjectProperty() {
        var token, key, id, value, param, node = new Node();

        token = lookahead;

        if (token.type === Token.Identifier) {

            id = parseObjectPropertyKey();

            // Property Assignment: Getter and Setter.

            if (token.value === 'get' && !match(':')) {
                key = parseObjectPropertyKey();
                expect('(');
                expect(')');
                value = parsePropertyFunction([]);
                return node.finishProperty('get', key, value);
            }
            if (token.value === 'set' && !match(':')) {
                key = parseObjectPropertyKey();
                expect('(');
                token = lookahead;
                if (token.type !== Token.Identifier) {
                    expect(')');
                    throwErrorTolerant(token, Messages.UnexpectedToken, token.value);
                    value = parsePropertyFunction([]);
                } else {
                    param = [ parseVariableIdentifier() ];
                    expect(')');
                    value = parsePropertyFunction(param, token);
                }
                return node.finishProperty('set', key, value);
            }
            expect(':');
            value = parseAssignmentExpression();
            return node.finishProperty('init', id, value);
        }
        if (token.type === Token.EOF || token.type === Token.Punctuator) {
            throwUnexpected(token);
        } else {
            key = parseObjectPropertyKey();
            expect(':');
            value = parseAssignmentExpression();
            return node.finishProperty('init', key, value);
        }
    }

    function parseObjectInitialiser() {
        var properties = [], token, property, name, key, kind, map = {}, toString = String, node = new Node();

        expect('{');

        while (!match('}')) {
            property = parseObjectProperty();

            if (property.key.type === Syntax.Identifier) {
                name = property.key.name;
            } else {
                name = toString(property.key.value);
            }
            kind = (property.kind === 'init') ? PropertyKind.Data : (property.kind === 'get') ? PropertyKind.Get : PropertyKind.Set;

            key = '$' + name;
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                if (map[key] === PropertyKind.Data) {
                    if (strict && kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.StrictDuplicateProperty);
                    } else if (kind !== PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    }
                } else {
                    if (kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    } else if (map[key] & kind) {
                        throwErrorTolerant({}, Messages.AccessorGetSet);
                    }
                }
                map[key] |= kind;
            } else {
                map[key] = kind;
            }

            properties.push(property);

            if (!match('}')) {
                expectTolerant(',');
            }
        }

        expect('}');

        return node.finishObjectExpression(properties);
    }

    // 11.1.6 The Grouping Operator

    function parseGroupExpression() {
        var expr;

        expect('(');

        if (match(')')) {
            lex();
            return PlaceHolders.ArrowParameterPlaceHolder;
        }

        ++state.parenthesisCount;

        expr = parseExpression();

        expect(')');

        return expr;
    }


    // 11.1 Primary Expressions

    function parsePrimaryExpression() {
        var type, token, expr, node;

        if (match('(')) {
            return parseGroupExpression();
        }

        if (match('[')) {
            return parseArrayInitialiser();
        }

        if (match('{')) {
            return parseObjectInitialiser();
        }

        type = lookahead.type;
        node = new Node();

        if (type === Token.Identifier) {
            expr =  node.finishIdentifier(lex().value);
        } else if (type === Token.StringLiteral || type === Token.NumericLiteral) {
            if (strict && lookahead.octal) {
                throwErrorTolerant(lookahead, Messages.StrictOctalLiteral);
            }
            expr = node.finishLiteral(lex());
        } else if (type === Token.Keyword) {
            if (matchKeyword('function')) {
                return parseFunctionExpression();
            }
            if (matchKeyword('this')) {
                lex();
                expr = node.finishThisExpression();
            } else {
                throwUnexpected(lex());
            }
        } else if (type === Token.BooleanLiteral) {
            token = lex();
            token.value = (token.value === 'true');
            expr = node.finishLiteral(token);
        } else if (type === Token.NullLiteral) {
            token = lex();
            token.value = null;
            expr = node.finishLiteral(token);
        } else if (match('/') || match('/=')) {
            if (typeof extra.tokens !== 'undefined') {
                expr = node.finishLiteral(collectRegex());
            } else {
                expr = node.finishLiteral(scanRegExp());
            }
            peek();
        } else {
            throwUnexpected(lex());
        }

        return expr;
    }

    // 11.2 Left-Hand-Side Expressions

    function parseArguments() {
        var args = [];

        expect('(');

        if (!match(')')) {
            while (index < length) {
                args.push(parseAssignmentExpression());
                if (match(')')) {
                    break;
                }
                expectTolerant(',');
            }
        }

        expect(')');

        return args;
    }

    function parseNonComputedProperty() {
        var token, node = new Node();

        token = lex();

        if (!isIdentifierName(token)) {
            throwUnexpected(token);
        }

        return node.finishIdentifier(token.value);
    }

    function parseNonComputedMember() {
        expect('.');

        return parseNonComputedProperty();
    }

    function parseComputedMember() {
        var expr;

        expect('[');

        expr = parseExpression();

        expect(']');

        return expr;
    }

    function parseNewExpression() {
        var callee, args, node = new Node();

        expectKeyword('new');
        callee = parseLeftHandSideExpression();
        args = match('(') ? parseArguments() : [];

        return node.finishNewExpression(callee, args);
    }

    function parseLeftHandSideExpressionAllowCall() {
        var expr, args, property, startToken, previousAllowIn = state.allowIn;

        startToken = lookahead;
        state.allowIn = true;
        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        for (;;) {
            if (match('.')) {
                property = parseNonComputedMember();
                expr = new WrappingNode(startToken).finishMemberExpression('.', expr, property);
            } else if (match('(')) {
                args = parseArguments();
                expr = new WrappingNode(startToken).finishCallExpression(expr, args);
            } else if (match('[')) {
                property = parseComputedMember();
                expr = new WrappingNode(startToken).finishMemberExpression('[', expr, property);
            } else {
                break;
            }
        }
        state.allowIn = previousAllowIn;

        return expr;
    }

    function parseLeftHandSideExpression() {
        var expr, property, startToken;
        assert(state.allowIn, 'callee of new expression always allow in keyword.');

        startToken = lookahead;

        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();

        for (;;) {
            if (match('[')) {
                property = parseComputedMember();
                expr = new WrappingNode(startToken).finishMemberExpression('[', expr, property);
            } else if (match('.')) {
                property = parseNonComputedMember();
                expr = new WrappingNode(startToken).finishMemberExpression('.', expr, property);
            } else {
                break;
            }
        }
        return expr;
    }

    // 11.3 Postfix Expressions

    function parsePostfixExpression() {
        var expr, token, startToken = lookahead;

        expr = parseLeftHandSideExpressionAllowCall();

        if (lookahead.type === Token.Punctuator) {
            if ((match('++') || match('--')) && !peekLineTerminator()) {
                // 11.3.1, 11.3.2
                if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                    throwErrorTolerant({}, Messages.StrictLHSPostfix);
                }

                if (!isLeftHandSide(expr)) {
                    throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
                }

                token = lex();
                expr = new WrappingNode(startToken).finishPostfixExpression(token.value, expr);
            }
        }

        return expr;
    }

    // 11.4 Unary Operators

    function parseUnaryExpression() {
        var token, expr, startToken;

        if (lookahead.type !== Token.Punctuator && lookahead.type !== Token.Keyword) {
            expr = parsePostfixExpression();
        } else if (match('++') || match('--')) {
            startToken = lookahead;
            token = lex();
            expr = parseUnaryExpression();
            // 11.4.4, 11.4.5
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant({}, Messages.StrictLHSPrefix);
            }

            if (!isLeftHandSide(expr)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            expr = new WrappingNode(startToken).finishUnaryExpression(token.value, expr);
        } else if (match('+') || match('-') || match('~') || match('!')) {
            startToken = lookahead;
            token = lex();
            expr = parseUnaryExpression();
            expr = new WrappingNode(startToken).finishUnaryExpression(token.value, expr);
        } else if (matchKeyword('delete') || matchKeyword('void') || matchKeyword('typeof')) {
            startToken = lookahead;
            token = lex();
            expr = parseUnaryExpression();
            expr = new WrappingNode(startToken).finishUnaryExpression(token.value, expr);
            if (strict && expr.operator === 'delete' && expr.argument.type === Syntax.Identifier) {
                throwErrorTolerant({}, Messages.StrictDelete);
            }
        } else {
            expr = parsePostfixExpression();
        }

        return expr;
    }

    function binaryPrecedence(token, allowIn) {
        var prec = 0;

        if (token.type !== Token.Punctuator && token.type !== Token.Keyword) {
            return 0;
        }

        switch (token.value) {
        case '||':
            prec = 1;
            break;

        case '&&':
            prec = 2;
            break;

        case '|':
            prec = 3;
            break;

        case '^':
            prec = 4;
            break;

        case '&':
            prec = 5;
            break;

        case '==':
        case '!=':
        case '===':
        case '!==':
            prec = 6;
            break;

        case '<':
        case '>':
        case '<=':
        case '>=':
        case 'instanceof':
            prec = 7;
            break;

        case 'in':
            prec = allowIn ? 7 : 0;
            break;

        case '<<':
        case '>>':
        case '>>>':
            prec = 8;
            break;

        case '+':
        case '-':
            prec = 9;
            break;

        case '*':
        case '/':
        case '%':
            prec = 11;
            break;

        default:
            break;
        }

        return prec;
    }

    // 11.5 Multiplicative Operators
    // 11.6 Additive Operators
    // 11.7 Bitwise Shift Operators
    // 11.8 Relational Operators
    // 11.9 Equality Operators
    // 11.10 Binary Bitwise Operators
    // 11.11 Binary Logical Operators

    function parseBinaryExpression() {
        var marker, markers, expr, token, prec, stack, right, operator, left, i;

        marker = lookahead;
        left = parseUnaryExpression();
        if (left === PlaceHolders.ArrowParameterPlaceHolder) {
            return left;
        }

        token = lookahead;
        prec = binaryPrecedence(token, state.allowIn);
        if (prec === 0) {
            return left;
        }
        token.prec = prec;
        lex();

        markers = [marker, lookahead];
        right = parseUnaryExpression();

        stack = [left, token, right];

        while ((prec = binaryPrecedence(lookahead, state.allowIn)) > 0) {

            // Reduce: make a binary expression from the three topmost entries.
            while ((stack.length > 2) && (prec <= stack[stack.length - 2].prec)) {
                right = stack.pop();
                operator = stack.pop().value;
                left = stack.pop();
                markers.pop();
                expr = new WrappingNode(markers[markers.length - 1]).finishBinaryExpression(operator, left, right);
                stack.push(expr);
            }

            // Shift.
            token = lex();
            token.prec = prec;
            stack.push(token);
            markers.push(lookahead);
            expr = parseUnaryExpression();
            stack.push(expr);
        }

        // Final reduce to clean-up the stack.
        i = stack.length - 1;
        expr = stack[i];
        markers.pop();
        while (i > 1) {
            expr = new WrappingNode(markers.pop()).finishBinaryExpression(stack[i - 1].value, stack[i - 2], expr);
            i -= 2;
        }

        return expr;
    }


    // 11.12 Conditional Operator

    function parseConditionalExpression() {
        var expr, previousAllowIn, consequent, alternate, startToken;

        startToken = lookahead;

        expr = parseBinaryExpression();
        if (expr === PlaceHolders.ArrowParameterPlaceHolder) {
            return expr;
        }
        if (match('?')) {
            lex();
            previousAllowIn = state.allowIn;
            state.allowIn = true;
            consequent = parseAssignmentExpression();
            state.allowIn = previousAllowIn;
            expect(':');
            alternate = parseAssignmentExpression();

            expr = new WrappingNode(startToken).finishConditionalExpression(expr, consequent, alternate);
        }

        return expr;
    }

    // [ES6] 14.2 Arrow Function

    function parseConciseBody() {
        if (match('{')) {
            return parseFunctionSourceElements();
        }
        return parseAssignmentExpression();
    }

    function reinterpretAsCoverFormalsList(expressions) {
        var i, len, param, params, defaults, defaultCount, options, rest;

        params = [];
        defaults = [];
        defaultCount = 0;
        rest = null;
        options = {
            paramSet: {}
        };

        for (i = 0, len = expressions.length; i < len; i += 1) {
            param = expressions[i];
            if (param.type === Syntax.Identifier) {
                params.push(param);
                defaults.push(null);
                validateParam(options, param, param.name);
            } else if (param.type === Syntax.AssignmentExpression) {
                params.push(param.left);
                defaults.push(param.right);
                ++defaultCount;
                validateParam(options, param.left, param.left.name);
            } else {
                return null;
            }
        }

        if (options.message === Messages.StrictParamDupe) {
            throwError(
                strict ? options.stricted : options.firstRestricted,
                options.message
            );
        }

        if (defaultCount === 0) {
            defaults = [];
        }

        return {
            params: params,
            defaults: defaults,
            rest: rest,
            stricted: options.stricted,
            firstRestricted: options.firstRestricted,
            message: options.message
        };
    }

    function parseArrowFunctionExpression(options, node) {
        var previousStrict, body;

        expect('=>');
        previousStrict = strict;

        body = parseConciseBody();

        if (strict && options.firstRestricted) {
            throwError(options.firstRestricted, options.message);
        }
        if (strict && options.stricted) {
            throwErrorTolerant(options.stricted, options.message);
        }

        strict = previousStrict;

        return node.finishArrowFunctionExpression(options.params, options.defaults, body, body.type !== Syntax.BlockStatement);
    }

    // 11.13 Assignment Operators

    function parseAssignmentExpression() {
        var oldParenthesisCount, token, expr, right, list, startToken;

        oldParenthesisCount = state.parenthesisCount;

        startToken = lookahead;
        token = lookahead;

        expr = parseConditionalExpression();

        if (expr === PlaceHolders.ArrowParameterPlaceHolder || match('=>')) {
            if (state.parenthesisCount === oldParenthesisCount ||
                    state.parenthesisCount === (oldParenthesisCount + 1)) {
                if (expr.type === Syntax.Identifier) {
                    list = reinterpretAsCoverFormalsList([ expr ]);
                } else if (expr.type === Syntax.AssignmentExpression) {
                    list = reinterpretAsCoverFormalsList([ expr ]);
                } else if (expr.type === Syntax.SequenceExpression) {
                    list = reinterpretAsCoverFormalsList(expr.expressions);
                } else if (expr === PlaceHolders.ArrowParameterPlaceHolder) {
                    list = reinterpretAsCoverFormalsList([]);
                }
                if (list) {
                    return parseArrowFunctionExpression(list, new WrappingNode(startToken));
                }
            }
        }

        if (matchAssign()) {
            // LeftHandSideExpression
            if (!isLeftHandSide(expr)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            // 11.13.1
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant(token, Messages.StrictLHSAssignment);
            }

            token = lex();
            right = parseAssignmentExpression();
            expr = new WrappingNode(startToken).finishAssignmentExpression(token.value, expr, right);
        }

        return expr;
    }

    // 11.14 Comma Operator

    function parseExpression() {
        var expr, startToken = lookahead, expressions;

        expr = parseAssignmentExpression();

        if (match(',')) {
            expressions = [expr];

            while (index < length) {
                if (!match(',')) {
                    break;
                }
                lex();
                expressions.push(parseAssignmentExpression());
            }

            expr = new WrappingNode(startToken).finishSequenceExpression(expressions);
        }

        return expr;
    }

    // 12.1 Block

    function parseStatementList() {
        var list = [],
            statement;

        while (index < length) {
            if (match('}')) {
                break;
            }
            statement = parseSourceElement();
            if (typeof statement === 'undefined') {
                break;
            }
            list.push(statement);
        }

        return list;
    }

    function parseBlock() {
        var block, node = new Node();

        expect('{');

        block = parseStatementList();

        expect('}');

        return node.finishBlockStatement(block);
    }

    // 12.2 Variable Statement

    function parseVariableIdentifier() {
        var token, node = new Node();

        token = lex();

        if (token.type !== Token.Identifier) {
            throwUnexpected(token);
        }

        return node.finishIdentifier(token.value);
    }

    function parseVariableDeclaration(kind) {
        var init = null, id, node = new Node();

        id = parseVariableIdentifier();

        // 12.2.1
        if (strict && isRestrictedWord(id.name)) {
            throwErrorTolerant({}, Messages.StrictVarName);
        }

        if (kind === 'const') {
            expect('=');
            init = parseAssignmentExpression();
        } else if (match('=')) {
            lex();
            init = parseAssignmentExpression();
        }

        return node.finishVariableDeclarator(id, init);
    }

    function parseVariableDeclarationList(kind) {
        var list = [];

        do {
            list.push(parseVariableDeclaration(kind));
            if (!match(',')) {
                break;
            }
            lex();
        } while (index < length);

        return list;
    }

    function parseVariableStatement(node) {
        var declarations;

        expectKeyword('var');

        declarations = parseVariableDeclarationList();

        consumeSemicolon();

        return node.finishVariableDeclaration(declarations, 'var');
    }

    // kind may be `const` or `let`
    // Both are experimental and not in the specification yet.
    // see http://wiki.ecmascript.org/doku.php?id=harmony:const
    // and http://wiki.ecmascript.org/doku.php?id=harmony:let
    function parseConstLetDeclaration(kind) {
        var declarations, node = new Node();

        expectKeyword(kind);

        declarations = parseVariableDeclarationList(kind);

        consumeSemicolon();

        return node.finishVariableDeclaration(declarations, kind);
    }

    // 12.3 Empty Statement

    function parseEmptyStatement() {
        var node = new Node();
        expect(';');
        return node.finishEmptyStatement();
    }

    // 12.4 Expression Statement

    function parseExpressionStatement(node) {
        var expr = parseExpression();
        consumeSemicolon();
        return node.finishExpressionStatement(expr);
    }

    // 12.5 If statement

    function parseIfStatement(node) {
        var test, consequent, alternate;

        expectKeyword('if');

        expect('(');

        test = parseExpression();

        expect(')');

        consequent = parseStatement();

        if (matchKeyword('else')) {
            lex();
            alternate = parseStatement();
        } else {
            alternate = null;
        }

        return node.finishIfStatement(test, consequent, alternate);
    }

    // 12.6 Iteration Statements

    function parseDoWhileStatement(node) {
        var body, test, oldInIteration;

        expectKeyword('do');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        if (match(';')) {
            lex();
        }

        return node.finishDoWhileStatement(body, test);
    }

    function parseWhileStatement(node) {
        var test, body, oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        return node.finishWhileStatement(test, body);
    }

    function parseForVariableDeclaration() {
        var token, declarations, node = new Node();

        token = lex();
        declarations = parseVariableDeclarationList();

        return node.finishVariableDeclaration(declarations, token.value);
    }

    function parseForStatement(node) {
        var init, test, update, left, right, body, oldInIteration, previousAllowIn = state.allowIn;

        init = test = update = null;

        expectKeyword('for');

        expect('(');

        if (match(';')) {
            lex();
        } else {
            if (matchKeyword('var') || matchKeyword('let')) {
                state.allowIn = false;
                init = parseForVariableDeclaration();
                state.allowIn = previousAllowIn;

                if (init.declarations.length === 1 && matchKeyword('in')) {
                    lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            } else {
                state.allowIn = false;
                init = parseExpression();
                state.allowIn = previousAllowIn;

                if (matchKeyword('in')) {
                    // LeftHandSideExpression
                    if (!isLeftHandSide(init)) {
                        throwErrorTolerant({}, Messages.InvalidLHSInForIn);
                    }

                    lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            }

            if (typeof left === 'undefined') {
                expect(';');
            }
        }

        if (typeof left === 'undefined') {

            if (!match(';')) {
                test = parseExpression();
            }
            expect(';');

            if (!match(')')) {
                update = parseExpression();
            }
        }

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        return (typeof left === 'undefined') ?
                node.finishForStatement(init, test, update, body) :
                node.finishForInStatement(left, right, body);
    }

    // 12.7 The continue statement

    function parseContinueStatement(node) {
        var label = null, key;

        expectKeyword('continue');

        // Optimize the most common form: 'continue;'.
        if (source.charCodeAt(index) === 0x3B) {
            lex();

            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return node.finishContinueStatement(null);
        }

        if (peekLineTerminator()) {
            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return node.finishContinueStatement(null);
        }

        if (lookahead.type === Token.Identifier) {
            label = parseVariableIdentifier();

            key = '$' + label.name;
            if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !state.inIteration) {
            throwError({}, Messages.IllegalContinue);
        }

        return node.finishContinueStatement(label);
    }

    // 12.8 The break statement

    function parseBreakStatement(node) {
        var label = null, key;

        expectKeyword('break');

        // Catch the very common case first: immediately a semicolon (U+003B).
        if (source.charCodeAt(index) === 0x3B) {
            lex();

            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return node.finishBreakStatement(null);
        }

        if (peekLineTerminator()) {
            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return node.finishBreakStatement(null);
        }

        if (lookahead.type === Token.Identifier) {
            label = parseVariableIdentifier();

            key = '$' + label.name;
            if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !(state.inIteration || state.inSwitch)) {
            throwError({}, Messages.IllegalBreak);
        }

        return node.finishBreakStatement(label);
    }

    // 12.9 The return statement

    function parseReturnStatement(node) {
        var argument = null;

        expectKeyword('return');

        if (!state.inFunctionBody) {
            throwErrorTolerant({}, Messages.IllegalReturn);
        }

        // 'return' followed by a space and an identifier is very common.
        if (source.charCodeAt(index) === 0x20) {
            if (isIdentifierStart(source.charCodeAt(index + 1))) {
                argument = parseExpression();
                consumeSemicolon();
                return node.finishReturnStatement(argument);
            }
        }

        if (peekLineTerminator()) {
            return node.finishReturnStatement(null);
        }

        if (!match(';')) {
            if (!match('}') && lookahead.type !== Token.EOF) {
                argument = parseExpression();
            }
        }

        consumeSemicolon();

        return node.finishReturnStatement(argument);
    }

    // 12.10 The with statement

    function parseWithStatement(node) {
        var object, body;

        if (strict) {
            // TODO(ikarienator): Should we update the test cases instead?
            skipComment();
            throwErrorTolerant({}, Messages.StrictModeWith);
        }

        expectKeyword('with');

        expect('(');

        object = parseExpression();

        expect(')');

        body = parseStatement();

        return node.finishWithStatement(object, body);
    }

    // 12.10 The swith statement

    function parseSwitchCase() {
        var test, consequent = [], statement, node = new Node();

        if (matchKeyword('default')) {
            lex();
            test = null;
        } else {
            expectKeyword('case');
            test = parseExpression();
        }
        expect(':');

        while (index < length) {
            if (match('}') || matchKeyword('default') || matchKeyword('case')) {
                break;
            }
            statement = parseStatement();
            consequent.push(statement);
        }

        return node.finishSwitchCase(test, consequent);
    }

    function parseSwitchStatement(node) {
        var discriminant, cases, clause, oldInSwitch, defaultFound;

        expectKeyword('switch');

        expect('(');

        discriminant = parseExpression();

        expect(')');

        expect('{');

        cases = [];

        if (match('}')) {
            lex();
            return node.finishSwitchStatement(discriminant, cases);
        }

        oldInSwitch = state.inSwitch;
        state.inSwitch = true;
        defaultFound = false;

        while (index < length) {
            if (match('}')) {
                break;
            }
            clause = parseSwitchCase();
            if (clause.test === null) {
                if (defaultFound) {
                    throwError({}, Messages.MultipleDefaultsInSwitch);
                }
                defaultFound = true;
            }
            cases.push(clause);
        }

        state.inSwitch = oldInSwitch;

        expect('}');

        return node.finishSwitchStatement(discriminant, cases);
    }

    // 12.13 The throw statement

    function parseThrowStatement(node) {
        var argument;

        expectKeyword('throw');

        if (peekLineTerminator()) {
            throwError({}, Messages.NewlineAfterThrow);
        }

        argument = parseExpression();

        consumeSemicolon();

        return node.finishThrowStatement(argument);
    }

    // 12.14 The try statement

    function parseCatchClause() {
        var param, body, node = new Node();

        expectKeyword('catch');

        expect('(');
        if (match(')')) {
            throwUnexpected(lookahead);
        }

        param = parseVariableIdentifier();
        // 12.14.1
        if (strict && isRestrictedWord(param.name)) {
            throwErrorTolerant({}, Messages.StrictCatchVariable);
        }

        expect(')');
        body = parseBlock();
        return node.finishCatchClause(param, body);
    }

    function parseTryStatement(node) {
        var block, handlers = [], finalizer = null;

        expectKeyword('try');

        block = parseBlock();

        if (matchKeyword('catch')) {
            handlers.push(parseCatchClause());
        }

        if (matchKeyword('finally')) {
            lex();
            finalizer = parseBlock();
        }

        if (handlers.length === 0 && !finalizer) {
            throwError({}, Messages.NoCatchOrFinally);
        }

        return node.finishTryStatement(block, [], handlers, finalizer);
    }

    // 12.15 The debugger statement

    function parseDebuggerStatement(node) {
        expectKeyword('debugger');

        consumeSemicolon();

        return node.finishDebuggerStatement();
    }

    // 12 Statements

    function parseStatement() {
        var type = lookahead.type,
            expr,
            labeledBody,
            key,
            node;

        if (type === Token.EOF) {
            throwUnexpected(lookahead);
        }

        if (type === Token.Punctuator && lookahead.value === '{') {
            return parseBlock();
        }

        node = new Node();

        if (type === Token.Punctuator) {
            switch (lookahead.value) {
            case ';':
                return parseEmptyStatement(node);
            case '(':
                return parseExpressionStatement(node);
            default:
                break;
            }
        } else if (type === Token.Keyword) {
            switch (lookahead.value) {
            case 'break':
                return parseBreakStatement(node);
            case 'continue':
                return parseContinueStatement(node);
            case 'debugger':
                return parseDebuggerStatement(node);
            case 'do':
                return parseDoWhileStatement(node);
            case 'for':
                return parseForStatement(node);
            case 'function':
                return parseFunctionDeclaration(node);
            case 'if':
                return parseIfStatement(node);
            case 'return':
                return parseReturnStatement(node);
            case 'switch':
                return parseSwitchStatement(node);
            case 'throw':
                return parseThrowStatement(node);
            case 'try':
                return parseTryStatement(node);
            case 'var':
                return parseVariableStatement(node);
            case 'while':
                return parseWhileStatement(node);
            case 'with':
                return parseWithStatement(node);
            default:
                break;
            }
        }

        expr = parseExpression();

        // 12.12 Labelled Statements
        if ((expr.type === Syntax.Identifier) && match(':')) {
            lex();

            key = '$' + expr.name;
            if (Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.Redeclaration, 'Label', expr.name);
            }

            state.labelSet[key] = true;
            labeledBody = parseStatement();
            delete state.labelSet[key];
            return node.finishLabeledStatement(expr, labeledBody);
        }

        consumeSemicolon();

        return node.finishExpressionStatement(expr);
    }

    // 13 Function Definition

    function parseFunctionSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted,
            oldLabelSet, oldInIteration, oldInSwitch, oldInFunctionBody, oldParenthesisCount,
            node = new Node();

        expect('{');

        while (index < length) {
            if (lookahead.type !== Token.StringLiteral) {
                break;
            }
            token = lookahead;

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = source.slice(token.start + 1, token.end - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        oldLabelSet = state.labelSet;
        oldInIteration = state.inIteration;
        oldInSwitch = state.inSwitch;
        oldInFunctionBody = state.inFunctionBody;
        oldParenthesisCount = state.parenthesizedCount;

        state.labelSet = {};
        state.inIteration = false;
        state.inSwitch = false;
        state.inFunctionBody = true;
        state.parenthesizedCount = 0;

        while (index < length) {
            if (match('}')) {
                break;
            }
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }

        expect('}');

        state.labelSet = oldLabelSet;
        state.inIteration = oldInIteration;
        state.inSwitch = oldInSwitch;
        state.inFunctionBody = oldInFunctionBody;
        state.parenthesizedCount = oldParenthesisCount;

        return node.finishBlockStatement(sourceElements);
    }

    function validateParam(options, param, name) {
        var key = '$' + name;
        if (strict) {
            if (isRestrictedWord(name)) {
                options.stricted = param;
                options.message = Messages.StrictParamName;
            }
            if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
                options.stricted = param;
                options.message = Messages.StrictParamDupe;
            }
        } else if (!options.firstRestricted) {
            if (isRestrictedWord(name)) {
                options.firstRestricted = param;
                options.message = Messages.StrictParamName;
            } else if (isStrictModeReservedWord(name)) {
                options.firstRestricted = param;
                options.message = Messages.StrictReservedWord;
            } else if (Object.prototype.hasOwnProperty.call(options.paramSet, key)) {
                options.firstRestricted = param;
                options.message = Messages.StrictParamDupe;
            }
        }
        options.paramSet[key] = true;
    }

    function parseParam(options) {
        var token, param, def;

        token = lookahead;
        param = parseVariableIdentifier();
        validateParam(options, token, token.value);
        if (match('=')) {
            lex();
            def = parseAssignmentExpression();
            ++options.defaultCount;
        }

        options.params.push(param);
        options.defaults.push(def);

        return !match(')');
    }

    function parseParams(firstRestricted) {
        var options;

        options = {
            params: [],
            defaultCount: 0,
            defaults: [],
            firstRestricted: firstRestricted
        };

        expect('(');

        if (!match(')')) {
            options.paramSet = {};
            while (index < length) {
                if (!parseParam(options)) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        if (options.defaultCount === 0) {
            options.defaults = [];
        }

        return {
            params: options.params,
            defaults: options.defaults,
            stricted: options.stricted,
            firstRestricted: options.firstRestricted,
            message: options.message
        };
    }

    function parseFunctionDeclaration() {
        var id, params = [], defaults = [], body, token, stricted, tmp, firstRestricted, message, previousStrict, node = new Node();

        expectKeyword('function');
        token = lookahead;
        id = parseVariableIdentifier();
        if (strict) {
            if (isRestrictedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictFunctionName);
            }
        } else {
            if (isRestrictedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictFunctionName;
            } else if (isStrictModeReservedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictReservedWord;
            }
        }

        tmp = parseParams(firstRestricted);
        params = tmp.params;
        defaults = tmp.defaults;
        stricted = tmp.stricted;
        firstRestricted = tmp.firstRestricted;
        if (tmp.message) {
            message = tmp.message;
        }

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && stricted) {
            throwErrorTolerant(stricted, message);
        }
        strict = previousStrict;

        return node.finishFunctionDeclaration(id, params, defaults, body);
    }

    function parseFunctionExpression() {
        var token, id = null, stricted, firstRestricted, message, tmp,
            params = [], defaults = [], body, previousStrict, node = new Node();

        expectKeyword('function');

        if (!match('(')) {
            token = lookahead;
            id = parseVariableIdentifier();
            if (strict) {
                if (isRestrictedWord(token.value)) {
                    throwErrorTolerant(token, Messages.StrictFunctionName);
                }
            } else {
                if (isRestrictedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictFunctionName;
                } else if (isStrictModeReservedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictReservedWord;
                }
            }
        }

        tmp = parseParams(firstRestricted);
        params = tmp.params;
        defaults = tmp.defaults;
        stricted = tmp.stricted;
        firstRestricted = tmp.firstRestricted;
        if (tmp.message) {
            message = tmp.message;
        }

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && stricted) {
            throwErrorTolerant(stricted, message);
        }
        strict = previousStrict;

        return node.finishFunctionExpression(id, params, defaults, body);
    }

    // 14 Program

    function parseSourceElement() {
        if (lookahead.type === Token.Keyword) {
            switch (lookahead.value) {
            case 'const':
            case 'let':
                return parseConstLetDeclaration(lookahead.value);
            case 'function':
                return parseFunctionDeclaration();
            default:
                return parseStatement();
            }
        }

        if (lookahead.type !== Token.EOF) {
            return parseStatement();
        }
    }

    function parseSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted;

        while (index < length) {
            token = lookahead;
            if (token.type !== Token.StringLiteral) {
                break;
            }

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = source.slice(token.start + 1, token.end - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        while (index < length) {
            sourceElement = parseSourceElement();
            /* istanbul ignore if */
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }
        return sourceElements;
    }

    function parseProgram() {
        var body, node;

        skipComment();
        peek();
        node = new Node();
        strict = false;

        body = parseSourceElements();
        return node.finishProgram(body);
    }

    function filterTokenLocation() {
        var i, entry, token, tokens = [];

        for (i = 0; i < extra.tokens.length; ++i) {
            entry = extra.tokens[i];
            token = {
                type: entry.type,
                value: entry.value
            };
            if (extra.range) {
                token.range = entry.range;
            }
            if (extra.loc) {
                token.loc = entry.loc;
            }
            tokens.push(token);
        }

        extra.tokens = tokens;
    }

    function tokenize(code, options) {
        var toString,
            tokens;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        lookahead = null;
        state = {
            allowIn: true,
            labelSet: {},
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false,
            lastCommentStart: -1
        };

        extra = {};

        // Options matching.
        options = options || {};

        // Of course we collect tokens here.
        options.tokens = true;
        extra.tokens = [];
        extra.tokenize = true;
        // The following two fields are necessary to compute the Regex tokens.
        extra.openParenToken = -1;
        extra.openCurlyToken = -1;

        extra.range = (typeof options.range === 'boolean') && options.range;
        extra.loc = (typeof options.loc === 'boolean') && options.loc;

        if (typeof options.comment === 'boolean' && options.comment) {
            extra.comments = [];
        }
        if (typeof options.tolerant === 'boolean' && options.tolerant) {
            extra.errors = [];
        }

        try {
            peek();
            if (lookahead.type === Token.EOF) {
                return extra.tokens;
            }

            lex();
            while (lookahead.type !== Token.EOF) {
                try {
                    lex();
                } catch (lexError) {
                    if (extra.errors) {
                        extra.errors.push(lexError);
                        // We have to break on the first error
                        // to avoid infinite loops.
                        break;
                    } else {
                        throw lexError;
                    }
                }
            }

            filterTokenLocation();
            tokens = extra.tokens;
            if (typeof extra.comments !== 'undefined') {
                tokens.comments = extra.comments;
            }
            if (typeof extra.errors !== 'undefined') {
                tokens.errors = extra.errors;
            }
        } catch (e) {
            throw e;
        } finally {
            extra = {};
        }
        return tokens;
    }

    function parse(code, options) {
        var program, toString;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        lookahead = null;
        state = {
            allowIn: true,
            labelSet: {},
            parenthesisCount: 0,
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false,
            lastCommentStart: -1
        };

        extra = {};
        if (typeof options !== 'undefined') {
            extra.range = (typeof options.range === 'boolean') && options.range;
            extra.loc = (typeof options.loc === 'boolean') && options.loc;
            extra.attachComment = (typeof options.attachComment === 'boolean') && options.attachComment;

            if (extra.loc && options.source !== null && options.source !== undefined) {
                extra.source = toString(options.source);
            }

            if (typeof options.tokens === 'boolean' && options.tokens) {
                extra.tokens = [];
            }
            if (typeof options.comment === 'boolean' && options.comment) {
                extra.comments = [];
            }
            if (typeof options.tolerant === 'boolean' && options.tolerant) {
                extra.errors = [];
            }
            if (extra.attachComment) {
                extra.range = true;
                extra.comments = [];
                extra.bottomRightStack = [];
                extra.trailingComments = [];
                extra.leadingComments = [];
            }
        }

        try {
            program = parseProgram();
            if (typeof extra.comments !== 'undefined') {
                program.comments = extra.comments;
            }
            if (typeof extra.tokens !== 'undefined') {
                filterTokenLocation();
                program.tokens = extra.tokens;
            }
            if (typeof extra.errors !== 'undefined') {
                program.errors = extra.errors;
            }
        } catch (e) {
            throw e;
        } finally {
            extra = {};
        }

        return program;
    }

    // Sync with *.json manifests.
    exports.version = '2.0.0-dev';

    exports.tokenize = tokenize;

    exports.parse = parse;

    // Deep copy.
   /* istanbul ignore next */
    exports.Syntax = (function () {
        var name, types = {};

        if (typeof Object.create === 'function') {
            types = Object.create(null);
        }

        for (name in Syntax) {
            if (Syntax.hasOwnProperty(name)) {
                types[name] = Syntax[name];
            }
        }

        if (typeof Object.freeze === 'function') {
            Object.freeze(types);
        }

        return types;
    }());

}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],6:[function(require,module,exports){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/*jslint vars:false, bitwise:true*/
/*jshint indent:4*/
/*global exports:true, define:true*/
(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // and plain browser loading,
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.estraverse = {}));
    }
}(this, function (exports) {
    'use strict';

    var Syntax,
        isArray,
        VisitorOption,
        VisitorKeys,
        BREAK,
        SKIP;

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MethodDefinition: 'MethodDefinition',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    function ignoreJSHintError() { }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function deepCopy(obj) {
        var ret = {}, key, val;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    ret[key] = deepCopy(val);
                } else {
                    ret[key] = val;
                }
            }
        }
        return ret;
    }

    function shallowCopy(obj) {
        var ret = {}, key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    ignoreJSHintError(shallowCopy);

    // based on LLVM libc++ upper_bound / lower_bound
    // MIT License

    function upperBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                len = diff;
            } else {
                i = current + 1;
                len -= diff + 1;
            }
        }
        return i;
    }

    function lowerBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                i = current + 1;
                len -= diff + 1;
            } else {
                len = diff;
            }
        }
        return i;
    }
    ignoreJSHintError(lowerBound);

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        ArrowFunctionExpression: ['params', 'defaults', 'rest', 'body'],
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ClassBody: ['body'],
        ClassDeclaration: ['id', 'body', 'superClass'],
        ClassExpression: ['id', 'body', 'superClass'],
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        ForOfStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'defaults', 'rest', 'body'],
        FunctionExpression: ['id', 'params', 'defaults', 'rest', 'body'],
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        MethodDefinition: ['key', 'value'],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handlers', 'handler', 'guardedHandlers', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body'],
        YieldExpression: ['argument']
    };

    // unique id
    BREAK = {};
    SKIP = {};

    VisitorOption = {
        Break: BREAK,
        Skip: SKIP
    };

    function Reference(parent, key) {
        this.parent = parent;
        this.key = key;
    }

    Reference.prototype.replace = function replace(node) {
        this.parent[this.key] = node;
    };

    function Element(node, path, wrap, ref) {
        this.node = node;
        this.path = path;
        this.wrap = wrap;
        this.ref = ref;
    }

    function Controller() { }

    // API:
    // return property path array from root to current node
    Controller.prototype.path = function path() {
        var i, iz, j, jz, result, element;

        function addToPath(result, path) {
            if (isArray(path)) {
                for (j = 0, jz = path.length; j < jz; ++j) {
                    result.push(path[j]);
                }
            } else {
                result.push(path);
            }
        }

        // root node
        if (!this.__current.path) {
            return null;
        }

        // first node is sentinel, second node is root element
        result = [];
        for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
        }
        addToPath(result, this.__current.path);
        return result;
    };

    // API:
    // return array of parent elements
    Controller.prototype.parents = function parents() {
        var i, iz, result;

        // first node is sentinel
        result = [];
        for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
        }

        return result;
    };

    // API:
    // return current node
    Controller.prototype.current = function current() {
        return this.__current.node;
    };

    Controller.prototype.__execute = function __execute(callback, element) {
        var previous, result;

        result = undefined;

        previous  = this.__current;
        this.__current = element;
        this.__state = null;
        if (callback) {
            result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
        }
        this.__current = previous;

        return result;
    };

    // API:
    // notify control skip / break
    Controller.prototype.notify = function notify(flag) {
        this.__state = flag;
    };

    // API:
    // skip child nodes of current node
    Controller.prototype.skip = function () {
        this.notify(SKIP);
    };

    // API:
    // break traversals
    Controller.prototype['break'] = function () {
        this.notify(BREAK);
    };

    Controller.prototype.__initialize = function(root, visitor) {
        this.visitor = visitor;
        this.root = root;
        this.__worklist = [];
        this.__leavelist = [];
        this.__current = null;
        this.__state = null;
    };

    Controller.prototype.traverse = function traverse(root, visitor) {
        var worklist,
            leavelist,
            element,
            node,
            nodeType,
            ret,
            key,
            current,
            current2,
            candidates,
            candidate,
            sentinel;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        worklist.push(new Element(root, null, null, null));
        leavelist.push(new Element(null, null, null, null));

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                ret = this.__execute(visitor.leave, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }
                continue;
            }

            if (element.node) {

                ret = this.__execute(visitor.enter, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }

                worklist.push(sentinel);
                leavelist.push(element);

                if (this.__state === SKIP || ret === SKIP) {
                    continue;
                }

                node = element.node;
                nodeType = element.wrap || node.type;
                candidates = VisitorKeys[nodeType];

                current = candidates.length;
                while ((current -= 1) >= 0) {
                    key = candidates[current];
                    candidate = node[key];
                    if (!candidate) {
                        continue;
                    }

                    if (!isArray(candidate)) {
                        worklist.push(new Element(candidate, key, null, null));
                        continue;
                    }

                    current2 = candidate.length;
                    while ((current2 -= 1) >= 0) {
                        if (!candidate[current2]) {
                            continue;
                        }
                        if ((nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === candidates[current]) {
                            element = new Element(candidate[current2], [key, current2], 'Property', null);
                        } else {
                            element = new Element(candidate[current2], [key, current2], null, null);
                        }
                        worklist.push(element);
                    }
                }
            }
        }
    };

    Controller.prototype.replace = function replace(root, visitor) {
        var worklist,
            leavelist,
            node,
            nodeType,
            target,
            element,
            current,
            current2,
            candidates,
            candidate,
            sentinel,
            outer,
            key;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        outer = {
            root: root
        };
        element = new Element(root, null, null, new Reference(outer, 'root'));
        worklist.push(element);
        leavelist.push(element);

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                target = this.__execute(visitor.leave, element);

                // node may be replaced with null,
                // so distinguish between undefined and null in this place
                if (target !== undefined && target !== BREAK && target !== SKIP) {
                    // replace
                    element.ref.replace(target);
                }

                if (this.__state === BREAK || target === BREAK) {
                    return outer.root;
                }
                continue;
            }

            target = this.__execute(visitor.enter, element);

            // node may be replaced with null,
            // so distinguish between undefined and null in this place
            if (target !== undefined && target !== BREAK && target !== SKIP) {
                // replace
                element.ref.replace(target);
                element.node = target;
            }

            if (this.__state === BREAK || target === BREAK) {
                return outer.root;
            }

            // node may be null
            node = element.node;
            if (!node) {
                continue;
            }

            worklist.push(sentinel);
            leavelist.push(element);

            if (this.__state === SKIP || target === SKIP) {
                continue;
            }

            nodeType = element.wrap || node.type;
            candidates = VisitorKeys[nodeType];

            current = candidates.length;
            while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                    continue;
                }

                if (!isArray(candidate)) {
                    worklist.push(new Element(candidate, key, null, new Reference(node, key)));
                    continue;
                }

                current2 = candidate.length;
                while ((current2 -= 1) >= 0) {
                    if (!candidate[current2]) {
                        continue;
                    }
                    if (nodeType === Syntax.ObjectExpression && 'properties' === candidates[current]) {
                        element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                    } else {
                        element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                    }
                    worklist.push(element);
                }
            }
        }

        return outer.root;
    };

    function traverse(root, visitor) {
        var controller = new Controller();
        return controller.traverse(root, visitor);
    }

    function replace(root, visitor) {
        var controller = new Controller();
        return controller.replace(root, visitor);
    }

    function extendCommentRange(comment, tokens) {
        var target;

        target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
        });

        comment.extendedRange = [comment.range[0], comment.range[1]];

        if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
        }

        target -= 1;
        if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
        }

        return comment;
    }

    function attachComments(tree, providedComments, tokens) {
        // At first, we should calculate extended comment ranges.
        var comments = [], comment, len, i, cursor;

        if (!tree.range) {
            throw new Error('attachComments needs range information');
        }

        // tokens array is empty, we attach comments to tree as 'leadingComments'
        if (!tokens.length) {
            if (providedComments.length) {
                for (i = 0, len = providedComments.length; i < len; i += 1) {
                    comment = deepCopy(providedComments[i]);
                    comment.extendedRange = [0, tree.range[0]];
                    comments.push(comment);
                }
                tree.leadingComments = comments;
            }
            return tree;
        }

        for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
        }

        // This is based on John Freeman's implementation.
        cursor = 0;
        traverse(tree, {
            enter: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (comment.extendedRange[1] > node.range[0]) {
                        break;
                    }

                    if (comment.extendedRange[1] === node.range[0]) {
                        if (!node.leadingComments) {
                            node.leadingComments = [];
                        }
                        node.leadingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        cursor = 0;
        traverse(tree, {
            leave: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (node.range[1] < comment.extendedRange[0]) {
                        break;
                    }

                    if (node.range[1] === comment.extendedRange[0]) {
                        if (!node.trailingComments) {
                            node.trailingComments = [];
                        }
                        node.trailingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        return tree;
    }

    exports.version = '1.5.1-dev';
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.attachComments = attachComments;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
    exports.Controller = Controller;
}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],7:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS 'AS IS'
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    function isExpression(node) {
        if (node == null) { return false; }
        switch (node.type) {
            case 'ArrayExpression':
            case 'AssignmentExpression':
            case 'BinaryExpression':
            case 'CallExpression':
            case 'ConditionalExpression':
            case 'FunctionExpression':
            case 'Identifier':
            case 'Literal':
            case 'LogicalExpression':
            case 'MemberExpression':
            case 'NewExpression':
            case 'ObjectExpression':
            case 'SequenceExpression':
            case 'ThisExpression':
            case 'UnaryExpression':
            case 'UpdateExpression':
                return true;
        }
        return false;
    }

    function isIterationStatement(node) {
        if (node == null) { return false; }
        switch (node.type) {
            case 'DoWhileStatement':
            case 'ForInStatement':
            case 'ForStatement':
            case 'WhileStatement':
                return true;
        }
        return false;
    }

    function isStatement(node) {
        if (node == null) { return false; }
        switch (node.type) {
            case 'BlockStatement':
            case 'BreakStatement':
            case 'ContinueStatement':
            case 'DebuggerStatement':
            case 'DoWhileStatement':
            case 'EmptyStatement':
            case 'ExpressionStatement':
            case 'ForInStatement':
            case 'ForStatement':
            case 'IfStatement':
            case 'LabeledStatement':
            case 'ReturnStatement':
            case 'SwitchStatement':
            case 'ThrowStatement':
            case 'TryStatement':
            case 'VariableDeclaration':
            case 'WhileStatement':
            case 'WithStatement':
                return true;
        }
        return false;
    }

    function isSourceElement(node) {
      return isStatement(node) || node != null && node.type === 'FunctionDeclaration';
    }

    function trailingStatement(node) {
        switch (node.type) {
        case 'IfStatement':
            if (node.alternate != null) {
                return node.alternate;
            }
            return node.consequent;

        case 'LabeledStatement':
        case 'ForStatement':
        case 'ForInStatement':
        case 'WhileStatement':
        case 'WithStatement':
            return node.body;
        }
        return null;
    }

    function isProblematicIfStatement(node) {
        var current;

        if (node.type !== 'IfStatement') {
            return false;
        }
        if (node.alternate == null) {
            return false;
        }
        current = node.consequent;
        do {
            if (current.type === 'IfStatement') {
                if (current.alternate == null)  {
                    return true;
                }
            }
            current = trailingStatement(current);
        } while (current);

        return false;
    }

    module.exports = {
        isExpression: isExpression,
        isStatement: isStatement,
        isIterationStatement: isIterationStatement,
        isSourceElement: isSourceElement,
        isProblematicIfStatement: isProblematicIfStatement,

        trailingStatement: trailingStatement
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],8:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var Regex;

    // See `tools/generate-identifier-regex.js`.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
        NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
    };

    function isDecimalDigit(ch) {
        return (ch >= 48 && ch <= 57);   // 0..9
    }

    function isHexDigit(ch) {
        return isDecimalDigit(ch) || (97 <= ch && ch <= 102) || (65 <= ch && ch <= 70);
    }

    function isOctalDigit(ch) {
        return (ch >= 48 && ch <= 55);   // 0..7
    }

    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 0x20) || (ch === 0x09) || (ch === 0x0B) || (ch === 0x0C) || (ch === 0xA0) ||
            (ch >= 0x1680 && [0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF].indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 0x0A) || (ch === 0x0D) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch >= 48 && ch <= 57) ||         // 0..9
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    module.exports = {
        isDecimalDigit: isDecimalDigit,
        isHexDigit: isHexDigit,
        isOctalDigit: isOctalDigit,
        isWhiteSpace: isWhiteSpace,
        isLineTerminator: isLineTerminator,
        isIdentifierStart: isIdentifierStart,
        isIdentifierPart: isIdentifierPart
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],9:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var code = require('./code');

    function isStrictModeReservedWordES6(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isKeywordES5(id, strict) {
        // yield should not be treated as keyword under non-strict mode.
        if (!strict && id === 'yield') {
            return false;
        }
        return isKeywordES6(id, strict);
    }

    function isKeywordES6(id, strict) {
        if (strict && isStrictModeReservedWordES6(id)) {
            return true;
        }

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') || (id === 'try');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    function isReservedWordES5(id, strict) {
        return id === 'null' || id === 'true' || id === 'false' || isKeywordES5(id, strict);
    }

    function isReservedWordES6(id, strict) {
        return id === 'null' || id === 'true' || id === 'false' || isKeywordES6(id, strict);
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    function isIdentifierName(id) {
        var i, iz, ch;

        if (id.length === 0) {
            return false;
        }

        ch = id.charCodeAt(0);
        if (!code.isIdentifierStart(ch) || ch === 92) {  // \ (backslash)
            return false;
        }

        for (i = 1, iz = id.length; i < iz; ++i) {
            ch = id.charCodeAt(i);
            if (!code.isIdentifierPart(ch) || ch === 92) {  // \ (backslash)
                return false;
            }
        }
        return true;
    }

    function isIdentifierES5(id, strict) {
        return isIdentifierName(id) && !isReservedWordES5(id, strict);
    }

    function isIdentifierES6(id, strict) {
        return isIdentifierName(id) && !isReservedWordES6(id, strict);
    }

    module.exports = {
        isKeywordES5: isKeywordES5,
        isKeywordES6: isKeywordES6,
        isReservedWordES5: isReservedWordES5,
        isReservedWordES6: isReservedWordES6,
        isRestrictedWord: isRestrictedWord,
        isIdentifierName: isIdentifierName,
        isIdentifierES5: isIdentifierES5,
        isIdentifierES6: isIdentifierES6
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":8}],10:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


(function () {
    'use strict';

    exports.ast = require('./ast');
    exports.code = require('./code');
    exports.keyword = require('./keyword');
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./ast":7,"./code":8,"./keyword":9}],11:[function(require,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":16,"./source-map/source-map-generator":17,"./source-map/source-node":18}],12:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = {};
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i], aAllowDuplicates);
    }
    return set;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
    var isDuplicate = this.has(aStr);
    var idx = this._array.length;
    if (!isDuplicate || aAllowDuplicates) {
      this._array.push(aStr);
    }
    if (!isDuplicate) {
      this._set[util.toSetString(aStr)] = idx;
    }
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    return Object.prototype.hasOwnProperty.call(this._set,
                                                util.toSetString(aStr));
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (this.has(aStr)) {
      return this._set[util.toSetString(aStr)];
    }
    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

});

},{"./util":19,"amdefine":2}],13:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64 = require('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string.
   */
  exports.decode = function base64VLQ_decode(aStr) {
    var i = 0;
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (i >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }
      digit = base64.decode(aStr.charAt(i++));
      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    return {
      value: fromVLQSigned(result),
      rest: aStr.slice(i)
    };
  };

});

},{"./base64":14,"amdefine":2}],14:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var charToIntMap = {};
  var intToCharMap = {};

  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach(function (ch, index) {
      charToIntMap[ch] = index;
      intToCharMap[index] = ch;
    });

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function base64_encode(aNumber) {
    if (aNumber in intToCharMap) {
      return intToCharMap[aNumber];
    }
    throw new TypeError("Must be between 0 and 63: " + aNumber);
  };

  /**
   * Decode a single base 64 digit to an integer.
   */
  exports.decode = function base64_decode(aChar) {
    if (aChar in charToIntMap) {
      return charToIntMap[aChar];
    }
    throw new TypeError("Not a valid base 64 digit: " + aChar);
  };

});

},{"amdefine":2}],15:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the next
    //      closest element that is less than that element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element which is less than the one we are searching for, so we
    //      return null.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return aHaystack[mid];
    }
    else if (cmp > 0) {
      // aHaystack[mid] is greater than our needle.
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare);
      }
      // We did not find an exact match, return the next closest one
      // (termination case 2).
      return aHaystack[mid];
    }
    else {
      // aHaystack[mid] is less than our needle.
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare);
      }
      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (2) or (3) and return the appropriate thing.
      return aLow < 0
        ? null
        : aHaystack[aLow];
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the next lowest value checked if there is no exact hit. This is because
   * mappings between original and generated line/col pairs are single points,
   * and there is an implicit region between each of them, so a miss just means
   * that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare) {
    return aHaystack.length > 0
      ? recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack, aCompare)
      : null;
  };

});

},{"amdefine":2}],16:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: Optional. The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this._names = ArraySet.fromArray(names, true);
    this._sources = ArraySet.fromArray(sources, true);

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this.file = file;
  }

  /**
   * Create a SourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns SourceMapConsumer
   */
  SourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(SourceMapConsumer.prototype);

      smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
      smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;

      smc.__generatedMappings = aSourceMap._mappings.slice()
        .sort(util.compareByGeneratedPositions);
      smc.__originalMappings = aSourceMap._mappings.slice()
        .sort(util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(SourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot != null ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    get: function () {
      if (!this.__generatedMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    get: function () {
      if (!this.__originalMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var mappingSeparator = /^[,;]/;
      var str = aStr;
      var mapping;
      var temp;

      while (str.length > 0) {
        if (str.charAt(0) === ';') {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if (str.charAt(0) === ',') {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          temp = base64VLQ.decode(str);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
            // Original source.
            temp = base64VLQ.decode(str);
            mapping.source = this._sources.at(previousSource + temp.value);
            previousSource += temp.value;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source, but no line and column');
            }

            // Original line.
            temp = base64VLQ.decode(str);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source and line, but no column');
            }

            // Original column.
            temp = base64VLQ.decode(str);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
              // Original name.
              temp = base64VLQ.decode(str);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this.__generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            this.__originalMappings.push(mapping);
          }
        }
      }

      this.__generatedMappings.sort(util.compareByGeneratedPositions);
      this.__originalMappings.sort(util.compareByOriginalPositions);
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  SourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator);
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var mapping = this._findMapping(needle,
                                      this._generatedMappings,
                                      "generatedLine",
                                      "generatedColumn",
                                      util.compareByGeneratedPositions);

      if (mapping && mapping.generatedLine === needle.generatedLine) {
        var source = util.getArg(mapping, 'source', null);
        if (source != null && this.sourceRoot != null) {
          source = util.join(this.sourceRoot, source);
        }
        return {
          source: source,
          line: util.getArg(mapping, 'originalLine', null),
          column: util.getArg(mapping, 'originalColumn', null),
          name: util.getArg(mapping, 'name', null)
        };
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  SourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot != null) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot != null
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      throw new Error('"' + aSource + '" is not in the SourceMap.');
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      if (this.sourceRoot != null) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var mapping = this._findMapping(needle,
                                      this._originalMappings,
                                      "originalLine",
                                      "originalColumn",
                                      util.compareByOriginalPositions);

      if (mapping) {
        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null)
        };
      }

      return {
        line: null,
        column: null
      };
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source;
        if (source != null && sourceRoot != null) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name
        };
      }).forEach(aCallback, context);
    };

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./array-set":12,"./base64-vlq":13,"./binary-search":15,"./util":19,"amdefine":2}],17:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64VLQ = require('./base64-vlq');
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. You may pass an object with the following
   * properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: A root for all relative URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    if (!aArgs) {
      aArgs = {};
    }
    this._file = util.getArg(aArgs, 'file', null);
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = [];
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source != null) {
          newMapping.source = mapping.source;
          if (sourceRoot != null) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name != null) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      this._validateMapping(generated, original, source, name);

      if (source != null && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name != null && !this._names.has(name)) {
        this._names.add(name);
      }

      this._mappings.push({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot != null) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent != null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   * @param aSourceMapPath Optional. The dirname of the path to the source map
   *        to be applied. If relative, it is relative to the SourceMapConsumer.
   *        This parameter is needed when the two source maps aren't in the same
   *        directory, and the source map to be applied contains relative source
   *        paths. If so, those relative source paths need to be rewritten
   *        relative to the SourceMapGenerator.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
      var sourceFile = aSourceFile;
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (aSourceFile == null) {
        if (aSourceMapConsumer.file == null) {
          throw new Error(
            'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
            'or the source map\'s "file" property. Both were omitted.'
          );
        }
        sourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "sourceFile" relative if an absolute Url is passed.
      if (sourceRoot != null) {
        sourceFile = util.relative(sourceRoot, sourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "sourceFile"
      this._mappings.forEach(function (mapping) {
        if (mapping.source === sourceFile && mapping.originalLine != null) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source != null) {
            // Copy mapping
            mapping.source = original.source;
            if (aSourceMapPath != null) {
              mapping.source = util.join(aSourceMapPath, mapping.source)
            }
            if (sourceRoot != null) {
              mapping.source = util.relative(sourceRoot, mapping.source);
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name != null && mapping.name != null) {
              // Only use the identifier name if it's an identifier
              // in both SourceMaps
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source != null && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name != null && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aSourceMapPath != null) {
            sourceFile = util.join(aSourceMapPath, sourceFile);
          }
          if (sourceRoot != null) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          original: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      // The mappings must be guaranteed to be in sorted order before we start
      // serializing them or else the generated line numbers (which are defined
      // via the ';' separators) will be all messed up. Note: it might be more
      // performant to maintain the sorting as we insert them, rather than as we
      // serialize them, but the big O is the same either way.
      this._mappings.sort(util.compareByGeneratedPositions);

      for (var i = 0, len = this._mappings.length; i < len; i++) {
        mapping = this._mappings[i];

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositions(mapping, this._mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source != null) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // lines are stored 0-based in SourceMap spec version 3
          result += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name != null) {
            result += base64VLQ.encode(this._names.indexOf(mapping.name)
                                       - previousName);
            previousName = this._names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot != null) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents,
                                                    key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._file != null) {
        map.file = this._file;
      }
      if (this._sourceRoot != null) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this);
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});

},{"./array-set":12,"./base64-vlq":13,"./util":19,"amdefine":2}],18:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var SourceMapGenerator = require('./source-map-generator').SourceMapGenerator;
  var util = require('./util');

  // Matches a Windows-style `\r\n` newline or a `\n` newline used by all other
  // operating systems these days (capturing the result).
  var REGEX_NEWLINE = /(\r?\n)/;

  // Matches a Windows-style newline, or any character.
  var REGEX_CHARACTER = /\r\n|[\s\S]/g;

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine == null ? null : aLine;
    this.column = aColumn == null ? null : aColumn;
    this.source = aSource == null ? null : aSource;
    this.name = aName == null ? null : aName;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   * @param aRelativePath Optional. The path that relative sources in the
   *        SourceMapConsumer should be relative to.
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer, aRelativePath) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // All even indices of this array are one line of the generated code,
      // while all odd indices are the newlines between two adjacent lines
      // (since `REGEX_NEWLINE` captures its match).
      // Processed fragments are removed from this array, by calling `shiftNextLine`.
      var remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
      var shiftNextLine = function() {
        var lineContents = remainingLines.shift();
        // The last line of a file might not have a newline.
        var newLine = remainingLines.shift() || "";
        return lineContents + newLine;
      };

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping !== null) {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            var code = "";
            // Associate first line with "lastMapping"
            addMappingWithCode(lastMapping, shiftNextLine());
            lastGeneratedLine++;
            lastGeneratedColumn = 0;
            // The remaining code is added without mapping
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[0];
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[0] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
            // No more remaining code, continue
            lastMapping = mapping;
            return;
          }
        }
        // We add the generated code until the first mapping
        // to the SourceNode without any mapping.
        // Each line is added as separate string.
        while (lastGeneratedLine < mapping.generatedLine) {
          node.add(shiftNextLine());
          lastGeneratedLine++;
        }
        if (lastGeneratedColumn < mapping.generatedColumn) {
          var nextLine = remainingLines[0];
          node.add(nextLine.substr(0, mapping.generatedColumn));
          remainingLines[0] = nextLine.substr(mapping.generatedColumn);
          lastGeneratedColumn = mapping.generatedColumn;
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      if (remainingLines.length > 0) {
        if (lastMapping) {
          // Associate the remaining code in the current line with "lastMapping"
          addMappingWithCode(lastMapping, shiftNextLine());
        }
        // and add the remaining lines without any mapping
        node.add(remainingLines.join(""));
      }

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aRelativePath != null) {
            sourceFile = util.join(aRelativePath, sourceFile);
          }
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          var source = aRelativePath
            ? util.join(aRelativePath, mapping.source)
            : mapping.source;
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    var chunk;
    for (var i = 0, len = this.children.length; i < len; i++) {
      chunk = this.children[i];
      if (chunk instanceof SourceNode) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild instanceof SourceNode) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      for (var i = 0, len = this.children.length; i < len; i++) {
        if (this.children[i] instanceof SourceNode) {
          this.children[i].walkSourceContents(aFn);
        }
      }

      var sources = Object.keys(this.sourceContents);
      for (var i = 0, len = sources.length; i < len; i++) {
        aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
      }
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        if(lastOriginalSource !== original.source
           || lastOriginalLine !== original.line
           || lastOriginalColumn !== original.column
           || lastOriginalName !== original.name) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      chunk.match(REGEX_CHARACTER).forEach(function (ch, idx, array) {
        if (REGEX_NEWLINE.test(ch)) {
          generated.line++;
          generated.column = 0;
          // Mappings end at eol
          if (idx + 1 === array.length) {
            lastOriginalSource = null;
            sourceMappingActive = false;
          } else if (sourceMappingActive) {
            map.addMapping({
              source: original.source,
              original: {
                line: original.line,
                column: original.column
              },
              generated: {
                line: generated.line,
                column: generated.column
              },
              name: original.name
            });
          }
        } else {
          generated.column += ch.length;
        }
      });
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

});

},{"./source-map-generator":17,"./util":19,"amdefine":2}],19:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.]*)(?::(\d+))?(\S*)$/;
  var dataUrlRegexp = /^data:.+\,.+$/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[2],
      host: match[3],
      port: match[4],
      path: match[5]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = '';
    if (aParsedUrl.scheme) {
      url += aParsedUrl.scheme + ':';
    }
    url += '//';
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + '@';
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  /**
   * Normalizes a path, or the path portion of a URL:
   *
   * - Replaces consequtive slashes with one slash.
   * - Removes unnecessary '.' parts.
   * - Removes unnecessary '<dir>/..' parts.
   *
   * Based on code in the Node.js 'path' core module.
   *
   * @param aPath The path or url to normalize.
   */
  function normalize(aPath) {
    var path = aPath;
    var url = urlParse(aPath);
    if (url) {
      if (!url.path) {
        return aPath;
      }
      path = url.path;
    }
    var isAbsolute = (path.charAt(0) === '/');

    var parts = path.split(/\/+/);
    for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
      part = parts[i];
      if (part === '.') {
        parts.splice(i, 1);
      } else if (part === '..') {
        up++;
      } else if (up > 0) {
        if (part === '') {
          // The first part is blank if the path is absolute. Trying to go
          // above the root is a no-op. Therefore we can remove all '..' parts
          // directly after the root.
          parts.splice(i + 1, up);
          up = 0;
        } else {
          parts.splice(i, 2);
          up--;
        }
      }
    }
    path = parts.join('/');

    if (path === '') {
      path = isAbsolute ? '/' : '.';
    }

    if (url) {
      url.path = path;
      return urlGenerate(url);
    }
    return path;
  }
  exports.normalize = normalize;

  /**
   * Joins two paths/URLs.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be joined with the root.
   *
   * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
   *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
   *   first.
   * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
   *   is updated with the result and aRoot is returned. Otherwise the result
   *   is returned.
   *   - If aPath is absolute, the result is aPath.
   *   - Otherwise the two paths are joined with a slash.
   * - Joining for example 'http://' and 'www.example.com' is also supported.
   */
  function join(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }
    if (aPath === "") {
      aPath = ".";
    }
    var aPathUrl = urlParse(aPath);
    var aRootUrl = urlParse(aRoot);
    if (aRootUrl) {
      aRoot = aRootUrl.path || '/';
    }

    // `join(foo, '//www.example.org')`
    if (aPathUrl && !aPathUrl.scheme) {
      if (aRootUrl) {
        aPathUrl.scheme = aRootUrl.scheme;
      }
      return urlGenerate(aPathUrl);
    }

    if (aPathUrl || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    // `join('http://', 'www.example.com')`
    if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
      aRootUrl.host = aPath;
      return urlGenerate(aRootUrl);
    }

    var joined = aPath.charAt(0) === '/'
      ? aPath
      : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

    if (aRootUrl) {
      aRootUrl.path = joined;
      return urlGenerate(aRootUrl);
    }
    return joined;
  }
  exports.join = join;

  /**
   * Make a path relative to a URL or another path.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be made relative to aRoot.
   */
  function relative(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }

    aRoot = aRoot.replace(/\/$/, '');

    // XXX: It is possible to remove this block, and the tests still pass!
    var url = urlParse(aRoot);
    if (aPath.charAt(0) == "/" && url && url.path == "/") {
      return aPath.slice(1);
    }

    return aPath.indexOf(aRoot + '/') === 0
      ? aPath.substr(aRoot.length + 1)
      : aPath;
  }
  exports.relative = relative;

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    return '$' + aStr;
  }
  exports.toSetString = toSetString;

  function fromSetString(aStr) {
    return aStr.substr(1);
  }
  exports.fromSetString = fromSetString;

  function strcmp(aStr1, aStr2) {
    var s1 = aStr1 || "";
    var s2 = aStr2 || "";
    return (s1 > s2) - (s1 < s2);
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp;

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp || onlyCompareOriginal) {
      return cmp;
    }

    cmp = strcmp(mappingA.name, mappingB.name);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    return mappingA.generatedColumn - mappingB.generatedColumn;
  };
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings where the generated positions are
   * compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositions(mappingA, mappingB, onlyCompareGenerated) {
    var cmp;

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  };
  exports.compareByGeneratedPositions = compareByGeneratedPositions;

});

},{"amdefine":2}],20:[function(require,module,exports){
//     Underscore.js 1.4.4
//     http://underscorejs.org
//     (c) 2009-2013 Jeremy Ashkenas, DocumentCloud Inc.
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `global` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var push             = ArrayProto.push,
      slice            = ArrayProto.slice,
      concat           = ArrayProto.concat,
      toString         = ObjProto.toString,
      hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.4.4';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, l = obj.length; i < l; i++) {
        if (iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      for (var key in obj) {
        if (_.has(obj, key)) {
          if (iterator.call(context, obj[key], key, obj) === breaker) return;
        }
      }
    }
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results.push(iterator.call(context, value, index, list));
    });
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var length = obj.length;
    if (length !== +length) {
      var keys = _.keys(obj);
      length = keys.length;
    }
    each(obj, function(value, index, list) {
      index = keys ? keys[--length] : --length;
      if (!initial) {
        memo = obj[index];
        initial = true;
      } else {
        memo = iterator.call(context, memo, obj[index], index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, iterator, context) {
    var result;
    any(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(iterator, context);
    each(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, iterator, context) {
    return _.filter(obj, function(value, index, list) {
      return !iterator.call(context, value, index, list);
    }, context);
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(iterator, context);
    each(obj, function(value, index, list) {
      if (!(result = result && iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);
    each(obj, function(value, index, list) {
      if (result || (result = iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    return any(obj, function(value) {
      return value === target;
    });
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, function(value){ return value[key]; });
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs, first) {
    if (_.isEmpty(attrs)) return first ? void 0 : [];
    return _[first ? 'find' : 'filter'](obj, function(value) {
      for (var key in attrs) {
        if (attrs[key] !== value[key]) return false;
      }
      return true;
    });
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.where(obj, attrs, true);
  };

  // Return the maximum element or (element-based computation).
  // Can't optimize arrays of integers longer than 65,535 elements.
  // See [WebKit Bug 80797](https://bugs.webkit.org/show_bug.cgi?id=80797)
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.max.apply(Math, obj);
    }
    if (!iterator && _.isEmpty(obj)) return -Infinity;
    var result = {computed : -Infinity, value: -Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed >= result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.min.apply(Math, obj);
    }
    if (!iterator && _.isEmpty(obj)) return Infinity;
    var result = {computed : Infinity, value: Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed < result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Shuffle an array.
  _.shuffle = function(obj) {
    var rand;
    var index = 0;
    var shuffled = [];
    each(obj, function(value) {
      rand = _.random(index++);
      shuffled[index - 1] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // An internal function to generate lookup iterators.
  var lookupIterator = function(value) {
    return _.isFunction(value) ? value : function(obj){ return obj[value]; };
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, value, context) {
    var iterator = lookupIterator(value);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value : value,
        index : index,
        criteria : iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index < right.index ? -1 : 1;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(obj, value, context, behavior) {
    var result = {};
    var iterator = lookupIterator(value == null ? _.identity : value);
    each(obj, function(value, index) {
      var key = iterator.call(context, value, index, obj);
      behavior(result, key, value);
    });
    return result;
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = function(obj, value, context) {
    return group(obj, value, context, function(result, key, value) {
      (_.has(result, key) ? result[key] : (result[key] = [])).push(value);
    });
  };

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = function(obj, value, context) {
    return group(obj, value, context, function(result, key) {
      if (!_.has(result, key)) result[key] = 0;
      result[key]++;
    });
  };

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator, context) {
    iterator = iterator == null ? _.identity : lookupIterator(iterator);
    var value = iterator.call(context, obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely convert anything iterable into a real, live array.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    return (n != null) && !guard ? slice.call(array, 0, n) : array[0];
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n != null) && !guard) {
      return slice.call(array, Math.max(array.length - n, 0));
    } else {
      return array[array.length - 1];
    }
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, (n == null) || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, output) {
    each(input, function(value) {
      if (_.isArray(value)) {
        shallow ? push.apply(output, value) : flatten(value, shallow, output);
      } else {
        output.push(value);
      }
    });
    return output;
  };

  // Return a completely flattened version of an array.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator, context) {
    if (_.isFunction(isSorted)) {
      context = iterator;
      iterator = isSorted;
      isSorted = false;
    }
    var initial = iterator ? _.map(array, iterator, context) : array;
    var results = [];
    var seen = [];
    each(initial, function(value, index) {
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {
        seen.push(value);
        results.push(array[index]);
      }
    });
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(concat.apply(ArrayProto, arguments));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.indexOf(other, item) >= 0;
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));
    return _.filter(array, function(value){ return !_.contains(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var args = slice.call(arguments);
    var length = _.max(_.pluck(args, 'length'));
    var results = new Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(args, "" + i);
    }
    return results;
  };

  // The inverse operation to `_.zip`. If given an array of pairs it
  // returns an array of the paired elements split into two left and
  // right element arrays, if given an array of triples it returns a
  // three element array and so on. For example, `_.unzip` given
  // `[['a',1],['b',2],['c',3]]` returns the array
  // [['a','b','c'],[1,2,3]].
  _.unzip = function(tuples) {
      var maxLen = _.max(_.pluck(tuples, "length"))
      return _.times(maxLen, _.partial(_.pluck, tuples));
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, l = list.length; i < l; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, l = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = (isSorted < 0 ? Math.max(0, l + isSorted) : isSorted);
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);
    for (; i < l; i++) if (array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var hasIndex = from != null;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);
    }
    var i = (hasIndex ? from : array.length);
    while (i--) if (array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var len = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(len);

    while(idx < len) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (func.bind === nativeBind && nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context.
  _.partial = function(func) {
    var args = slice.call(arguments, 1);
    return function() {
      return func.apply(this, args.concat(slice.call(arguments)));
    };
  };

  // Bind all of an object's methods to that object. Useful for ensuring that
  // all callbacks defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length === 0) throw new Error("bindAll must be passed function names");
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time.
  _.throttle = function(func, wait, immediate) {
    var context, args, timeout, result;
    var previous = 0;
    var later = function() {
      previous = new Date;
      timeout = null;
      result = func.apply(context, args);
    };
    return function() {
      var now = new Date;
      if (!previous && immediate === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
      } else if (!timeout) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, result;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) result = func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) result = func.apply(context, args);
      return result;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      memo = func.apply(this, arguments);
      func = null;
      return memo;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return function() {
      var args = [func];
      push.apply(args, arguments);
      return wrapper.apply(this, args);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    if (times <= 0) return func();
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = nativeKeys || function(obj) {
    if (obj !== Object(obj)) throw new TypeError('Invalid object');
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var values = [];
    for (var key in obj) if (_.has(obj, key)) values.push(obj[key]);
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var pairs = [];
    for (var key in obj) if (_.has(obj, key)) pairs.push([key, obj[key]]);
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    for (var key in obj) if (_.has(obj, key)) result[obj[key]] = key;
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    each(keys, function(key) {
      if (key in obj) copy[key] = obj[key];
    });
    return copy;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    for (var key in obj) {
      if (!_.contains(keys, key)) copy[key] = obj[key];
    }
    return copy;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          if (obj[prop] === void 0) obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) return bStack[length] == b;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Objects with different constructors are not equivalent, but `Object`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&
                               _.isFunction(bCtor) && (bCtor instanceof bCtor))) {
        return false;
      }
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Optimize `isFunction` if appropriate.
  if (typeof (/./) !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj === 'function';
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj != +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  // Run a function **n** times.
  _.times = function(n, iterator, context) {
    var accum = Array(Math.max(0, n));
    for (var i = 0; i < n; i++) accum[i] = iterator.call(context, i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // List of HTML entities for escaping.
  var entityMap = {
    escape: {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    }
  };
  entityMap.unescape = _.invert(entityMap.escape);

  // Regexes containing the keys and values listed immediately above.
  var entityRegexes = {
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')
  };

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  _.each(['escape', 'unescape'], function(method) {
    _[method] = function(string) {
      if (string == null) return '';
      return ('' + string).replace(entityRegexes[method], function(match) {
        return entityMap[method][match];
      });
    };
  });

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name){
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    var render;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      }
      if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      }
      if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }
      index = offset + match.length;
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  _.extend(_.prototype, {

    // Start chaining a wrapped Underscore object.
    chain: function() {
      this._chain = true;
      return this;
    },

    // Extracts the result from a wrapped and chained object.
    value: function() {
      return this._wrapped;
    }

  });

}).call(this);

},{}],21:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');
  var error           = monitor.require('error');
  var _               = monitor.require('underscore');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.ArrayObject = ArrayObject;
  module.allocate    = allocate;

  // ------------------------------------------------------------

  function allocate(global) {
    var arrayConstructor = new ArrayConstructor(global.Array);
    var arrayPrototype   = arrayConstructor._proto; 

    return { ArrayConstructor : arrayConstructor,
             ArrayPrototype   : arrayPrototype
           };
  }

  // ------------------------------------------------------------
  // 15.4.3
  
  function ArrayConstructor(host) {
    Ecma.call(this);

    this.host = host;

    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Class      = 'Function';
    this.Extensible = true;
    this._proto     = new ArrayPrototype(this, host.prototype);

    ecma.DefineFFF(this,constants.length,1);
    ecma.DefineFFF(this,constants.prototype, this._proto);

    ecma.DefineTFT(this , constants.isArray , new BiFO(isArray , 1,Array.prototype.isArray ));
  }

  prelude.inherits(ArrayConstructor,Ecma);
  ArrayConstructor.prototype.HasInstance = _function.HasInstance;

  // ------------------------------------------------------------

  ArrayConstructor.prototype.Call = function(thisArg,args) {
    return this.Construct(args);
  };

  // ------------------------------------------------------------

  ArrayConstructor.prototype.Construct = function(args) {

    var array;
    var len = args.length;

    if (len === 0 || len >= 2) {
      array = ArrayObject.fromValueArray(args,bot);
    } else {

      var arg = args[0];
      if (typeof arg.value === 'number') {
        array = new ArrayObject();
        array.properties.length = arg.value;
        array.labels.length = {
          value     : arg.label,
          existence : bot
        };
      } else {
        array = ArrayObject.fromValueArray(args,bot);
      }
    }

    return new Value(array,bot);
  };

  // ------------------------------------------------------------
  // isArray, 15.4.3.1

  var isArray = function(thisArg, args) {
    var arg = args[0] || new Value(undefined,bot);

    if (arg === null || typeof arg.value !== 'object') {
      return new Value(false,arg.label);
    }

    return new Value(arg.value.Class === 'Array',arg.label);
  };

  // ------------------------------------------------------------
  // 15.4.4
  function ArrayPrototype(constructor, host) {
    Ecma.call(this);

    this.Prototype = new Value(monitor.instances.ObjectPrototype,bot);
    this.Class     = 'Array';

    this.host = host;
    
    ecma.Define(this, constants.length,0, { writable : true });
    ecma.DefineTFT(this, constants.constructor, constructor);

    ecma.DefineTFT(this, constants.toString      , new BiFO(toString      , 0, Array.prototype.toString));
    ecma.DefineTFT(this, constants.toLocaleString, new BiFO(toLocaleString, 0, Array.prototype.toLocaleString));
    ecma.DefineTFT(this, constants.concat        , new BiFO(concat        , 1, Array.prototype.concat));
    ecma.DefineTFT(this, constants.join          , new BiFO(join          , 1, Array.prototype.join));
    ecma.DefineTFT(this, constants.pop           , new BiFO(pop           , 0, Array.prototype.pop));
    ecma.DefineTFT(this, constants.push          , new BiFO(push          , 1, Array.prototype.push));
    ecma.DefineTFT(this, constants.reverse       , new BiFO(reverse       , 0, Array.prototype.reverse));
    ecma.DefineTFT(this, constants.shift         , new BiFO(shift         , 0, Array.prototype.shift));
    ecma.DefineTFT(this, constants.slice         , new BiFO(slice         , 2, Array.prototype.slice));
    ecma.DefineTFT(this, constants.sort          , new BiFO(sort          , 1, Array.prototype.sort));
    ecma.DefineTFT(this, constants.splice        , new BiFO(splice        , 2, Array.prototype.splice));
    ecma.DefineTFT(this, constants.unshift       , new BiFO(unshift       , 1, Array.prototype.unshift));
    ecma.DefineTFT(this, constants.indexOf       , new BiFO(indexOf       , 1, Array.prototype.indexOf));
    ecma.DefineTFT(this, constants.lastIndexOf   , new BiFO(lastIndexOf   , 1, Array.prototype.lastIndexOf));
    ecma.DefineTFT(this, constants.every         , new BiFO(every         , 1, Array.prototype.every));
    ecma.DefineTFT(this, constants.some          , new BiFO(some          , 1, Array.prototype.some));
    ecma.DefineTFT(this, constants.forEach       , new BiFO(forEach       , 1, Array.prototype.forEach));
    ecma.DefineTFT(this, constants.map           , new BiFO(map           , 1, Array.prototype.map));
    ecma.DefineTFT(this, constants.filter        , new BiFO(filter        , 1, Array.prototype.filter));
    ecma.DefineTFT(this, constants.reduce        , new BiFO(reduce        , 1, Array.prototype.reduce));
    ecma.DefineTFT(this, constants.reduceRight   , new BiFO(reduceRight   , 1, Array.prototype.reduceRight));

  }

  prelude.inherits(ArrayPrototype,Ecma);

  // ------------------------------------------------------------
  // toString, 15.4.4.2

  var toString = function(thisArg,args) {
    var array = conversion.ToObject(thisArg);
    var func  = array.Get(constants.join);

    if (!conversion.IsCallable(func).value) {
      func = monitor.instances.ObjectPrototype.Get(constants.toString);
    } 

    return func.value.Call(array,[]);
  };
  
  // ------------------------------------------------------------
  // toLocaleString, 15.4.4.3
  var toLocaleString = function(thisArg) {
    var array, arrayLen, len, separator, firstElement, R, elementObj,
        func, k, S, nextElement;
    
    array = conversion.ToObject(thisArg);
    arrayLen = array.Get(new Value("length", bot));
    len = conversion.ToUInt32(arrayLen);
    separator = ',';

    var label = lub(monitor.context.effectivePC, array.label);
    
    if(len.value === 0) {
      return new Value("", label);
    }

    firstElement = array.Get(new Value("0", bot));
    
    if(firstElement.value === undefined || firstElement.value === null) {
      R = new Value("", label);
    }
    else {
      elementObj = conversion.ToObject(firstElement);
      func = elementObj.Get(new Value("toLocaleString", bot));
      
      if(conversion.IsCallable(func).value === false) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.toLocaleString: not a function',
          bot
        );
      }

      R = func.value.Call(elementObj, []);
    }
    
    k = 1;
    while(k < len.value) {
      S = R.value.concat(separator);
      
      nextElement = array.Get(new Value('' + k, bot));

      if(nextElement.value === undefined || firstElement.value === null) {
        R = new Value("", label);
      }
      else {
        elementObj = conversion.ToObject(nextElement);
        func = elementObj.Get(new Value("toLocaleString", bot));

        if(conversion.IsCallable(func).value === false) {
          monitor.Throw(
            monitor.modules.error.TypeErrorObject,
            'Array.prototype.toLocaleString: not a function',
            bot
          );
        }

        R = func.value.Call(elementObj, []);
      }
      R = new Value(S.concat(R.value), R.label);
      k++;
    }

    R.raise(label);
    return R;
  }

  
  // ------------------------------------------------------------
  // concat, 15.4.4.4
  var concat = function(thisArg,args) {
    var O = conversion.ToObject(thisArg);
    var A = new ArrayObject();

    var n = 0;
    var c = monitor.context;
    var label = new Label();

    function aux(E) {
      c.pushPC(E.label); 

        label.lub(E.label);

        if (E.value && E.value.Class === 'Array') {
          var k   = 0;
          var len = E.Get(constants.length);
        
          label.lub(len.label);

          monitor.context.pushPC(len.label);

            while (k < len.value) {
              var _k = new Value(k,bot);
              var exists = E.HasProperty(_k);

              if (exists.value) {
                monitor.context.pushPC(exists.label);

                  var subElement = E.Get(_k);

                  A.DefineOwnProperty(new Value(n,label), {
                    value : subElement.value,
                    label : subElement.label, 
                    writable     : true,
                    enumerable   : true, 
                    configurable : true
                  }, false);

                monitor.context.popPC();
              }

              n++;
              k++;
            }

          monitor.context.popPC();

        } else {
          A.DefineOwnProperty(new Value(n,label), {
            value : E.value,
            label : E.label, 
            writable     : true,
            enumerable   : true, 
            configurable : true
          }, false);
          n++;
        }

      c.popPC();
    }

    aux(O);
    for (var i = 0, len = args.length; i < len; i++) {
      aux(args[i]);
    }

    // This is a fix they added in ECMA-262 v6 standard, but browsers used it
    // in ECMA-262 v5 as well.
    A.Put(new Value("length", bot), new Value(n, bot));
    
    return new Value(A,bot);
  };

  // ------------------------------------------------------------
  // join, 15.4.4.5
  
  function join(thisArg,args){
    var O   = conversion.ToObject(thisArg);
    var len = conversion.ToUInt32(O.Get(constants.length));


    var separator = args[0];
    
    if (separator) { 

      if (separator.value === undefined) {
        separator.value = ',';
      }
    
      separator = conversion.ToString(separator);
    } else {
      separator = new Value(undefined, bot);
    }

    var label = lub(len.label, separator.label); 
    var arr   = [];
    for (var i = 0; i < len.value; i++) {
     
      var v = O.Get(new Value(i,bot));
      var y;
      if (v.value === undefined || v.value === null) {
        y = new Value('', v.label); 
      } else {
        y = conversion.ToString(v);
      }

      arr[i] = y.value;

      label  = lub(label, y.label);
    }

    var res = arr.join(separator.value);
    return new Value(res,label);
  };

  // ------------------------------------------------------------
  // pop, 15.4.4.6

  function pop(thisArg,args){
    var O   = conversion.ToObject(thisArg);
    var len = conversion.ToUInt32(O.Get(constants.length));

    if (len.value === 0) {
      O.Put(constant.length, len, true);
      return new Value(undefined,len.label);
    }

    var indx = new Value(len.value-1,len.label);
    var element = O.Get(indx);

    O.Delete(indx, true);

    O.Put(constants.length,indx,true);
    return element;
  };

  // ------------------------------------------------------------
  // push, 15.4.4.7

  function push(thisArg,args){
    var O = conversion.ToObject(thisArg);
    var n = conversion.ToUInt32(O.Get(constants.length));

    for (var i = 0, len = args.length; i < len; i++) {
      var E = args[i];
      O.Put(n,E);
      n.value++;
    }

    O.Put(constants.length,n,true);

    return n;
  }

  // ------------------------------------------------------------
  // reverse, 15.4.4.8

  function reverse(thisArg,args) {
    var O = conversion.ToObject(thisArg);
    var len = conversion.ToUInt32(O.Get(constants.length));

    var P = len;
    len = len.value;

    var middle = Math.floor(len/2);
    var lower  = 0;

    var c = monitor.context;

    while (lower !== middle && lower > -2) {
      var upper = len - lower - 1;

      P.value = lower;
      var lowerValue = O.Get(P);
      P.value = upper;
      var upperValue = O.Get(P);
      P.value = lower;
      var lowerExists = O.HasProperty(P);
      P.value = upper;
      var upperExists = O.HasProperty(P);

      c.pushPC(lub(lowerExists.label,upperExists.label));

        if (lowerExists.value && upperExists.value) {
          P.value = lower;
          O.Put(P,upperValue,true);
          P.value = upper;
          O.Put(P,lowerValue,true);
        } else if (!lowerExists.value && upperExists.value) {
          P.value = lower;
          O.Put(P,upperValue,true);
          P.value = upper;
          O.Delete(P,true);
        } else if (lowerExists.value && !upperExists.value) {
          P.value = lower;
          O.Delete(P,true);
          P.value = upper;
          O.Put(P,lowerValue,true);
        }
      c.popPC();
      lower++;
    }
    
    return O;
  }

  // ------------------------------------------------------------
  // shift, 15.4.4.9

  function shift(thisArg, args) {
    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len    = conversion.ToUInt32(lenVal);

    if (len.value === 0) {
      monitor.context.pushPC(len.label);
        O.Put(constants.length, len, true);
      monitor.context.popPC();

      return new Value(undefined, len.label);
    }

    var first = O.Get(new Value(0,bot));
    var k = 1;

    monitor.context.pushPC(len.label);

      while (k < len.value) {
      
        var from  = k;
        var _from = new Value(from, len.label); 
        var to    = k - 1;
        var _to   = new Value(to, len.label);

        var fromPresent = O.HasProperty(_from);

        if (fromPresent.value) {
          monitor.context.pushPC(fromPresent.label);

            var fromVal = O.Get(_from);
            O.Put(_to, fromVal,true);

          monitor.context.popPC();
        } else {
          O.Delete(_to, true);
        }
        k++;
      }
    monitor.context.popPC();

    len.value--;
    O.Delete(len, true);
    O.Put(constants.length, len, true);

    return first;
  };
  

  // ------------------------------------------------------------
  // slice, 15.4.4.10

  function slice(thisArg,args) {
    var O = conversion.ToObject(thisArg);
    var A = new ArrayObject();

    var lenVal = O.Get(constants.length);
    var len    = conversion.ToUInt32(lenVal);

    var start  = args[0] ? args[0] : new Value(undefined,bot);
    var end    = args[1] ? args[1] : new Value(undefined,bot);

    var relativeStart = conversion.ToInteger(start);

    var k = new Value(0,lub(len.label, relativeStart.label));

    if (relativeStart.value < 0) {
      k.value = Math.max(len.value + relativeStart.value, 0);
    } else {
      k.value = Math.min(relativeStart.value, len.value);
    }

    var relativeEnd;
    if (end.value === undefined) {
      relativeEnd = len;
    } else {
      relativeEnd = conversion.ToInteger(end);
    }
    

    var _final = new Value(0,lub(len.label, relativeStart.label));

    if (relativeEnd.value < 0) {
      _final.value = Math.max(len.value + relativeEnd.value, 0);
    } else {
      _final.value = Math.min(relativeEnd.value, len.value);
    }

    var n = 0;

    monitor.context.pushPC(lub(k.label,_final.label));

      while (k.value < _final.value) {
        var Pk = conversion.ToString(k);
        var kPresent = O.HasProperty(Pk);
        if (kPresent.value) {
          var kValue = O.Get(Pk);
          A.DefineOwnProperty(new Value(n,bot), {
            value        : kValue.value, 
            label        : kValue.label,
            writable     : true,
            enumerable   : true,
            configurable : true
          }, false);
        }
        k.value++;
        n++;
      }
    
    monitor.context.popPC();
    return new Value(A,bot);
  };
    
  // ------------------------------------------------------------
  // sort, 15.4.4.11

  var sort = function(thisArg, args) {
    var comparefun = args[0] || new Value(undefined,bot);
    
    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);
    
    var label = new Label();
    label.lub(O.label, len.label);

    var c = monitor.context;
    c.pushPC(len.label);

      var array = [];
      var k = new Value(0,len.label);
      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);
        
        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
            var kValue = O.Get(k);
            kValue.raise(label);

            array[k.value] = kValue; 
        }
        k.value++;
      }
  
      var isCallable = conversion.IsCallable(comparefun);
      c.labels.pc.lub(isCallable.label);

      if (comparefun.value !== undefined && !isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.sort: not a function',
          bot
        );
      }
      
      var comparefunWrapper;
      if (comparefun.value) {
      
        comparefunWrapper = function(x,y) {
          if (x.value === undefined) {
            label.lub(x.label);
            return 1;
          }
          if (y.value === undefined) {
            label.lub(y.label);
            return -1;
          }
          var result = comparefun.Call(new Value(undefined,bot), [x,y]);
          c.labels.pc.lub(result.label,x.label,y.label);
          label.lub(result.label,x.label,y.label);
          return result.value;
        };

      } else {
        
        comparefunWrapper = function(x,y) {

          if (x.value === undefined) {
            label.lub(x.label);
            return 1;
          }
          if (y.value === undefined) {
            label.lub(y.label);
            return -1;
          }

          var xString = conversion.ToString(x);
          var yString = conversion.ToString(y);

          c.labels.pc.lub(xString.label,yString.label);
          label.lub(xString.label,yString.label);

          if (xString.value < yString.value) {
            return -1;
          }

          if (xString.value > yString.value) {
            return 1;
          }

          return 0;
        };

      }
      array = array.sort(comparefunWrapper);

      for (var i = 0, len = array.length; i < len; i++) {
        var v = array[i];
        
        if (v) {
          O.Put(new Value(i,label), v, true);
        } else {
          O.Delete(new Value(i,label), true);
        }
      }

    c.popPC();
    return O;
  };

  // ------------------------------------------------------------
  // splice, 15.4.4.12
  function splice(thisArg, args) {

    var start       = args[0] || new Value(undefined,bot);
    var deleteCount = args[1] || new Value(undefined,bot);
    
    var O = conversion.ToObject(thisArg);
    var A = new ArrayObject();

    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var relativeStart = conversion.ToInteger(start);
    var actualStart = new Value(null, lub(len.label, relativeStart.label));

    if (relativeStart.value < 0) {
      actualStart.value = Math.max((len.value + relativeStart.value), 0);
    } else {
      actualStart.value = Math.min(relativeStart.value,len.value);
    }

    deleteCount = conversion.ToInteger(deleteCount);
    var actualDeleteCount = new Value(null, lub(deleteCount.label,actualStart.label));
    actualDeleteCount.value = Math.min(Math.max(deleteCount.value, 0), len.value - actualStart.value);

    var k = 0;
    monitor.context.pushPC(actualDeleteCount.label);
      while (k < actualDeleteCount.value) {
        var from = new Value(actualStart.value + k, actualStart.label);
        var fromPresent = O.HasProperty(from);

        monitor.context.pushPC(fromPresent.label);
          if (fromPresent.value) {
            var fromValue = O.Get(from);
            A.DefineOwnProperty(new Value(k,actualDeleteCount.label), {
                value : fromValue.value,
                label : fromValue.label,
                writable : true,
                enumberable : true,
                configurable : true
              }
            );
          }
        monitor.context.popPC();

        k++;
      }
    monitor.context.popPC();

    var items = [];
    for (var i = 0; i < args.length - 2; i++) {
      items[i] = args[i+2];
    }

    var itemCount = items.length;
    if (itemCount < actualDeleteCount.value) {
      var k = actualStart.value;

      monitor.context.pushPC(actualStart.label);
      
        while (k < len.value - actualDeleteCount.value) {
          var from = new Value(k + actualDeleteCount.value, lub(actualStart.label, actualDeleteCount.label));
          var to   = new Value(k + itemCount, actualStart.label);
          var fromPresent = O.HasProperty(from);

          monitor.context.pushPC(fromPresent.label);

          if (fromPresent.value) {
            var fromValue = O.Get(from);
            O.Put(to,fromValue,true);
          } else {
            O.Delete(to, true);
          }

          k++;

          monitor.context.popPC();
        }
      
      monitor.context.popPC();

      k = len.value;

      monitor.context.pushPC(lub(len.label, actualDeleteCount.label));
      
        while (k > (len.value - actualDeleteCount.value + itemCount)) {
          O.Delete(new Value(k, len.label));
          k--;
        }

      monitor.context.popPC();

    } else if (itemCount > actualDeleteCount.value) {

      var k = len.value - actualDeleteCount.value;
    
      monitor.context.pushPC(lub(len.label, actualDeleteCount.label));
      
        while (k > actualStart.value) {
          var from = new Value(k + actualDeleteCount.value - 1, actualDeleteCount.label);
          var to = new Value(k + itemCount - 1, bot);
          var fromPresent = O.HasProperty(from);
      
            
          if (fromPresent.value) {
            var fromValue = O.Get(from);
            O.Put(to,fromValue,true);
          } else {
            O.Delete(to,true);
          }
          k--;
        }
      
      monitor.context.popPC();

    }

    k = actualStart.value;
    for (var i = 0; i < items.length; i++) {
      O.Put(new Value(k+i, actualStart.label), items[i], true);
    }

    O.Put(constants.length, new Value(len.value - actualDeleteCount.value + itemCount, lub(len.label, actualDeleteCount.label)), true);
    return new Value(A, bot);
  };

  // ------------------------------------------------------------
  // unshift, 15.4.4.13

  function unshift(thisArg, args) {
    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);
    var argCount = args.length;
    var k = len.value;

    monitor.context.pushPC(len.label);
      while (k > 0) {
        var from = new Value(k-1, len.label);
        var to = new Value(k+argCount-1, len.label);
        var fromPresent = O.HasProperty(from);

        monitor.context.pushPC(fromPresent.label);
          if (fromPresent.value) {
            var fromValue = O.Get(from);
            O.Put(to,fromValue,true);
          } else {
            O.Delete(to,true);
          }
        monitor.context.popPC();

        k--;
      }
    monitor.context.popPC();

    var j = 0;
    var items = args;
    for (; j < argCount; j++) {
      var E = items[j];
      O.Put(new Value(j,bot), E, true);
    }

    O.Put(constants.length, new Value(len.value + argCount, len.label));
    return new Value(len.value + argCount, len.label);
  };

  // ------------------------------------------------------------
  // indexOf, 15.4.4.14
  
  function indexOf(thisArg, args) {
    var searchElement = args[0] || new Value(undefined,bot);
    var fromIndex     = args[1]; 

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;

    if (len.value === 0) {
      return new Value(-1,len.label);
    }

    var label = new Label();
    c.pushPC(len.label);
    label.lub(len.label);

      var n = fromIndex ? conversion.ToInteger(fromIndex) : new Value(0,bot);

      c.labels.pc.lub(n.label);
      label.lub(n.label);

      if (n.value >= len.value) {
        c.popPC();
        return new Value(-1,label);
      }

      var k;
      if (n.value >= 0) {
        k = n;
      } else {
        k = new Value(len.value - Math.abs(n.value), lub(len.label,n.label));
        if (k.value < 0) {
          k.value = 0;
        }
      }

      while (k.value < len.value) {
        var kString = conversion.ToString(k);
        var kPresent = O.HasProperty(kString);

        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
          var elementK = O.Get(kString);
          
          c.labels.pc.lub(elementK.label);
          label.lub(elementK.label);

          var same = searchElement.value === elementK.value;

          if (same) {
            k.label = label;
            c.popPC();
            return k;
          }
        }

        k.value++;
      }

    c.popPC();
    k.value = -1;
    k.label = label;
    return k;
  }

  // ------------------------------------------------------------
  // lastIndexOf, 15.4.4.15

  function lastIndexOf(thisArg,args) {
    var searchElement = args[0] || new Value(undefined,bot);
    var fromIndex     = args[1]; 

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;

    if (len.value === 0) {
      return new Value(-1,len.label);
    }

    var label = new Label();

    c.pushPC(len.label);
    label.lub(len.label);

      var n = fromIndex ? conversion.ToInteger(fromIndex) : new Value(len.value - 1, len.label);
  
      var k;
      if (n.value >= 0) {
        k = new Value(Math.min(n.value, len.value - 1), lub(n.label,len.label));
      } else {
        k = new Value(len.value - Math.abs(n.value), lub(n.label,len.label));
      }

      c.labels.pc.lub(k.label);
      label.lub(k.label);

      while (k.value >= 0) {
        var kPresent = O.HasProperty(k);
        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
          var elementK = O.Get(k);

          c.labels.pc.lub(elementK.label);
          label.lub(elementK.label);

          var same = searchElement.value === elementK.value;

          if (same) {
            k.label = label;
            c.popPC();
            return k;
          }
        }
        k.value--;
      }

    c.popPC();
    
    k.value = -1;
    k.label = label;
    return k;
  }

  // ------------------------------------------------------------
  // every, 15.4.4.16

  function every(thisArg,args) {
    var callbackfn      = args[0] || new Value(undefined,bot);
    var callbackthisArg = args[1] || new Value(undefined,bot);

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    var label = new Label();
    label.lub(isCallable.label);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var k = new Value(0,len.label);
      c.labels.pc.lub(len.label);
      label.lub(len.label);
      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);
        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
          var kValue     = O.Get(k);
          var testResult = callbackfn.Call(callbackthisArg, [kValue, k, O]);
          var b = conversion.ToBoolean(testResult);
          c.labels.pc.lub(b.label);
          label.lub(b.label);

          if (!b.value) {
            c.popPC();
            return new Value(false,label);
          }
        }
        k.value++;
      }

    c.popPC();
    return new Value(true,label);
  }

  // ------------------------------------------------------------
  // some, 15.4.4.17

  function some(thisArg,args) {
    var callbackfn      = args[0] || new Value(undefined,bot);
    var callbackthisArg = args[1] || new Value(undefined,bot);

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    var label = new Label();
    label.lub(isCallable.label);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var k = new Value(0,len.label);
      c.labels.pc.lub(len.label);
      label.lub(len.label);
      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);
        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
          var kValue     = O.Get(k);
          var testResult = callbackfn.Call(callbackthisArg, [kValue, k, O]);
          var b = conversion.ToBoolean(testResult);
          c.labels.pc.lub(b.label);
          label.lub(b.label);

          if (b.value) {
            c.popPC();
            return new Value(true,label);
          }
        }
        k.value++;
      }

    c.popPC();
    return new Value(false,label);
  }

  // ------------------------------------------------------------
  // forEach, 15.4.4.18

  function forEach(thisArg,args) {
    var callbackfn      = args[0] || new Value(undefined,bot);
    var callbackthisArg = args[1] || new Value(undefined,bot);

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var k = new Value(0,len.label);
      c.labels.pc.lub(len.label);

      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);
        c.labels.pc.lub(kPresent.label);

        if (kPresent.value) {
          var kValue = O.Get(k);
          callbackfn.Call(callbackthisArg, [kValue, k, O]);
        }
        k.value++;
      }

    c.popPC();
    return new Value(undefined,bot);
  }

  // ------------------------------------------------------------
  // map, 15.4.4.19

  function map(thisArg,args) {
    var callbackfn      = args[0] || new Value(undefined,bot);
    var callbackthisArg = args[1] || new Value(undefined,bot);

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var A = new monitor.modules.array.ArrayObject();
      A.properties.length = len.value;
      A.labels.length = {
        value     : len.label,
        existence : bot
      };

      var k = new Value(0,len.label);
      c.labels.pc.lub(len.label);

      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);
        c.labels.pc.lub(kPresent.label);

        if (kPresent.value) {
          var kValue = O.Get(k);
          var mappedValue = callbackfn.Call(callbackthisArg, [kValue, k, O]);

          A.DefineOwnProperty(k, {
            value        : mappedValue.value, 
            label        : mappedValue.label,
            writable     : true,
            enumerable   : true,
            configurable : true
          }, false);

        }
        k.value++;
      }

    c.popPC();
    return new Value(A,bot);
  }

  // ------------------------------------------------------------
  // filter, 15.4.4.20

  function filter(thisArg,args) {
    var callbackfn      = args[0] || new Value(undefined,bot);
    var callbackthisArg = args[1] || new Value(undefined,bot);

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var A = new monitor.modules.array.ArrayObject();

      var k  = new Value(0,len.label);
      var to = new Value(0,len.label);

      c.labels.pc.lub(len.label);

      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);
        c.labels.pc.lub(kPresent.label);

        if (kPresent.value) {
          var kValue = O.Get(k);
          var selected = callbackfn.Call(callbackthisArg, [kValue, k, O]);
          selected = conversion.ToBoolean(selected);

          c.labels.pc.lub(selected.label);

          if (selected.value) {
            A.DefineOwnProperty(to, {
              value        : kValue.value,
              label        : kValue.label,
              writable     : true,
              enumerable   : true,
              configurable : true
            }, false);

            to.value++;
          }
        }
        k.value++;
      }

    c.popPC();
    return new Value(A,bot);
  }

  // ------------------------------------------------------------
  // reduce, 15.4.4.21

  function reduce(thisArg,args) {
    var callbackfn   = args[0] || new Value(undefined,bot);
    var initialValue = args[1];

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    var label = new Label();
    label.lub(isCallable.label);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var k  = new Value(0,len.label);
      var accumulator;

      if (initialValue) {
        accumulator = initialValue;
      } else {
        var kPresent = new Value(false,bot);

        c.labels.pc.lub(len.label);
        label.lub(len.label);

        while (!kPresent.value && k.value < len.value) {
          kPresent = O.HasProperty(k);

          c.labels.pc.lub(kPresent.label);
          label.lub(kPresent.label);

          if (kPresent.value) {
            accumulator = O.Get(k);
          }
          k.value++;
        }

        if (!kPresent.value) {
          monitor.Throw(
            monitor.modules.error.TypeErrorObject,
            'Array.prototype.reduce: empty array with no initial value',
            bot
          );
        }
      }

      while (k.value < len.value) {
        var kPresent = O.HasProperty(k);

        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
          var kValue = O.Get(k);
          accumulator = callbackfn.Call(new Value(undefined,bot), [accumulator, kValue, k, O]);
        }
        k.value++;
      }

    c.popPC();
    accumulator.raise(label);
    return accumulator;
  }

  // ------------------------------------------------------------
  // reduceRight, 15.4.4.22

  function reduceRight(thisArg,args) {
    var callbackfn   = args[0] || new Value(undefined,bot);
    var initialValue = args[1];

    var O = conversion.ToObject(thisArg);
    var lenVal = O.Get(constants.length);
    var len = conversion.ToUInt32(lenVal);

    var c = monitor.context;
    var isCallable = conversion.IsCallable(callbackfn);

    var label = new Label();
    label.lub(isCallable.label);

    c.pushPC(isCallable.label);

      if (!isCallable.value) {
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'Array.prototype.every: not a function',
          bot
        );
      }

      var k  = new Value(len.value - 1,len.label);
      var accumulator;

      if (initialValue) {
        accumulator = initialValue;
      } else {
        var kPresent = new Value(false,bot);

        c.labels.pc.lub(len.label);
        label.lub(len.label);

        while (!kPresent.value && k.value >= 0) {
          kPresent = O.HasProperty(k);

          c.labels.pc.lub(kPresent.label);
          label.lub(kPresent.label);

          if (kPresent.value) {
            accumulator = O.Get(k);
          }
          k.value--;
        }

        if (!kPresent.value) {
          monitor.Throw(
            monitor.modules.error.TypeErrorObject,
            'Array.prototype.reduce: empty array with no initial value',
            bot
          );
        }
      }

      while (k.value >= 0) {
        var kPresent = O.HasProperty(k);

        c.labels.pc.lub(kPresent.label);
        label.lub(kPresent.label);

        if (kPresent.value) {
          var kValue = O.Get(k);
          accumulator = callbackfn.Call(new Value(undefined,bot), [accumulator, kValue, k, O]);
        }
        k.value--;
      }

    c.popPC();
    accumulator.raise(label);
    return accumulator;
  }

  // ------------------------------------------------------------
  // 15.4.2.1, and 15.4.2.2

  function ArrayObject(struct) {
    Ecma.call(this);

    this.Class      = 'Array';
    
    this.Prototype  = new Value(monitor.instances.ArrayPrototype,bot);
    this.Extensible = true;

    this.properties = [];
    this.labels     = {};
    
    struct = struct || bot;
    this.labels.length = {
      value     : struct,
      existence : bot
    };

    this.struct = struct;
  }

  prelude.inherits(ArrayObject,Ecma);

  // ---

  ArrayObject.fromValueArray = function(values, struct) {
    var array = new ArrayObject(struct);

    for (var i = 0, len = values.length; i < len; i++) {
      var value = values[i];
      array.properties[i] = value.value;
      array.labels[i] = {
        value     : value.label,
        existence : bot
      };
    }
   
    return array;
  };

  // ---

  ArrayObject.fromPropertyArray = function(values, struct) {
    var array = new ArrayObject(struct);

    for (var i = 0, len = values.length; i < len; i++) {
      var value = values[i];
      array.properties[i] = value.value;
      array.labels[i] = {
        value     : value.label,
        existence : value.label
      };
    }
   
    return array;
  };

  // ---

  ArrayObject.fromArray = function(values, label, existence) {
    var array = new ArrayObject(existence);

    for (var i = 0, len = values.length; i < len; i++) {
      array.properties[i] = values[i];
      array.labels[i] = {
        value     : label,
        existence : existence
      };
    }
    return array;
  };

  // ---

  ArrayObject.prototype.toString = function() {
    return this.properties.toString();
  };

  // ---

  ArrayObject.prototype.DefineOwnProperty = function(s,desc,Throw) {
    var c = monitor.context;
    
    var lengthContext = lub(c.effectivePC, s.label);
    if (!le(lengthContext, this.labels.length.value)) {
      var msgt = _.template('Array.prototype.DefineOwnProperty: write context {{wc}} not below length label {{ll}}');
      monitor.securityError(msgt({wc : lengthContext, ll : this.labels.length.value }));
    }
     
    return Ecma.prototype.DefineOwnProperty.call(this,s,desc,Throw);
  };

  // ---

  ArrayObject.prototype.toNative = function(deep) {
    var clone = [];
    var lbl = new Label();

    for (var i = 0, len = this.properties.length; i < len; i++) {
      var v = this.properties[i];
      var t = typeof v;

      lbl.lub(this.labels[i].existence, this.labels[i].value);

      if (t !== 'object' && t !== 'function') {
        clone[i] = v;
      } else {
        clone[i] = null;
      }
    }

    return new Value(clone,lbl);

  };

  // ---
 
  return module;
};

},{}],22:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.BooleanObject = BooleanObject;
  module.allocate      = allocate;

  // ------------------------------------------------------------

  function allocate(global) {
    var booleanConstructor = new BooleanConstructor(global.Boolean);
    var booleanPrototype   = booleanConstructor._proto;
    return { BooleanConstructor : booleanConstructor,
             BooleanPrototype   : booleanPrototype
           };
  }

  // 15.6.2 -----------------------------------------------------

  function BooleanConstructor(host){
    Ecma.call(this);

    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot); 
    this.Class      = 'Function';
    this.Extensible = true;

    this._proto     = new BooleanPrototype(this, host.prototype);
    this.host       = host;

    ecma.DefineFFF(this, constants.length,1); //REMOVE ?
    ecma.DefineFFF(this, constants.prototype, this._proto);
  }

  prelude.inherits(BooleanConstructor,Ecma);
  BooleanConstructor.prototype.HasInstance = _function.HasInstance;

  // 15.6.1.1
  BooleanConstructor.prototype.Call = function(thisArg,args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);

    return conversion.ToBoolean(arg0);
  };

  // 15.6.2.1
  BooleanConstructor.prototype.Construct = function(args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);
    
    var b   = conversion.ToBoolean(arg0);
    var obj = new BooleanObject(b.value,b.label);

    return new Value(obj,bot);
  };

  // 15.6.4 ------------------------------------------------------------

  function BooleanPrototype(constructor,host) {
    Ecma.call(this);
  
    this.Class          = 'Boolean';
    this.PrimitiveValue = new Boolean(false);
    this.Prototype      = new Value(monitor.instances.ObjectPrototype,bot);

    this.host           = host;

    ecma.DefineFFF(this, constants.length, 1);
    ecma.DefineTFT(this, constants.constructor,constructor);
    ecma.DefineTFT(this, constants.toString, new BiFO(toString, 0, host.toString));
    ecma.DefineTFT(this, constants.valueOf , new BiFO(valueOf , 0, host.valueOf));
  }

  prelude.inherits(BooleanPrototype,Ecma);

  // toString, 15.6.4.2 -----------------------------------------

  var toString = function(thisArg,args) {
    var b = valueOf(thisArg);
    var s =  b.value ? 'true' : 'false';
    return new Value(s, b.label);
  };

  // valueOf, 15.6.4.3 ------------------------------------------ 

  var valueOf = function(thisArg,args) {

    if (typeof thisArg.value === 'boolean') {
      return thisArg;
    }

    if (thisArg.value !== null && 
        typeof thisArg.value === 'object' && 
        thisArg.value.Class === 'Boolean') {
      return new Value(thisArg.value.PrimitiveValue.valueOf(), thisArg.label);
    }

    monitor.Throw(
      monitor.modules.error.TypeErrorObject,
      'Boolean.prototype.valueOf is not generic',
      thisArg.label
    );
  };

  // ------------------------------------------------------------
  // Boolean Object, 15.6.5

  function BooleanObject(val,lbl) {
    Ecma.call(this);

    this.Class          = 'Boolean';
    this.PrimitiveValue = new Boolean(val);
    this.PrimitiveLabel = lbl;
    this.Extensible     = true;
    this.Prototype      = new Value(monitor.instances.BooleanPrototype,bot);

  }

  prelude.inherits(BooleanObject,Ecma);

  // ---

  BooleanObject.prototype.toNative = function(deep) {
    var v = new Boolean(this.PrimitiveValue);
    return new Value(v, this.PrimitiveLabel);
  };

  // ---

  return module;
};




},{}],23:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var Label = monitor.require('label').Label;
  var Value = monitor.require('values').Value;

  var strings = [
    'index',
    'input',
    'value',
    'writable',
    'enumerable',
    'configurable',
    'get',
    'set',
    'print',
    'console',
    'alert',
    'log',
    'prototype',
    'constructor',
    'length',
    'arguments',
    'upg',
    'upgv',
    'upgf',
    'upgs',
    'getPrototypeOf',
    'getOwnPropertyDescriptor',
    'getOwnPropertyNames',
    'create',
    'defineProperty',
    'defineProperties',
    'seal',
    'freeze',
    'preventExtensions',
    'isSealed',
    'isFrozen',
    'isExtensible',
    'keys',
    'toString',
    'toLocaleString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'apply',
    'call',
    'bind',
    'NaN',
    'Infinity',
    'undefined',
    'eval',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',
    'Object',
    'Function',
    'Array',
    'String',
    'Boolean',
    'Number',
    'Date',
    'RegExp',
    'Error',
    'EvalError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'TypeError',
    'URIError',
    'Math',
    'JSON',
    'parse',
    'stringify',
    'name',
    'message',
    'isArray',
    'concat',
    'join',
    'pop',
    'push',
    'reverse',
    'shift',
    'slice',
    'sort',
    'splice',
    'unshift',
    'indexOf',
    'lastIndexOf',
    'every',
    'some',
    'forEach',
    'map',
    'filter',
    'reduce',
    'reduceRight',
    'fromCharCode',
    'charAt',
    'charCodeAt',
    'localeCompare',
    'match',
    'replace',
    'search',
    'split',
    'substring',
    'substr',
    'toLowerCase',
    'toLocaleLowerCase',
    'toUpperCase',
    'toLocaleUpperCase',
    'trim',
    'MAX_VALUE',
    'MIN_VALUE',
    'NEGATIVE_INFINITY',
    'POSITIVE_INFINITY',
    'toFixed',
    'toExponential',
    'toPrecision',
    'E',
    'LN10',
    'LN2',
    'LOG2E',
    'LOG10E',
    'PI',
    'SQRT1_2',
    'SQRT2',
    'abs',
    'acos',
    'asin',
    'atan',
    'atan2',
    'ceil',
    'cos',
    'exp',
    'floor',
    'log',
    'max',
    'min',
    'pow',
    'random',
    'round',
    'sin',
    'sqrt',
    'tan',
    'toDateString',
    'toTimeString',
    'toLocaleDateString',
    'toLocaleTimeString',
    'getTime',
    'getFullYear',
    'getUTCFullYear',
    'getMonth',
    'getUTCMonth',
    'getDate',
    'getUTCDate',
    'getDay',
    'getUTCDay',
    'getHours',
    'getUTCHours',
    'getMinutes',
    'getUTCMinutes',
    'getSeconds',
    'getUTCSeconds',
    'getMilliseconds',
    'getUTCMilliseconds',
    'getTimezoneOffset',
    'setTime',
    'setMilliseconds',
    'setUTCMilliseconds',
    'setSeconds',
    'setUTCSeconds',
    'setMinutes',
    'setUTCMinutes',
    'setHours',
    'setUTCHours',
    'setDate',
    'setUTCDate',
    'setMonth',
    'setUTCMonth',
    'setFullYear',
    'setUTCFullYear',
    'toUTCString',
    'toISOString',
    'toJSON',
    'parse',
    'UTC',
    'now',
    'exec',
    'test',
    'source',
    'global',
    'ignoreCase',
    'multiline',
    'lastIndex'
  ];

  var module = {};

  for (var i = 0, len = strings.length; i < len; i++) {
    var str = strings[i];
    module[str] = new Value(str,Label.bot);
  }

  return module;
};

},{}],24:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var label = monitor.require('label');

  var Stack = monitor.require('stack').Stack;
  var Value = monitor.require('values').Value;
  var pp    = monitor.require('pp');
  var Label = label.Label;
  var lub   = label.lub;
  var bot   = Label.bot;


  var module = {};
  module.Context = Context;
  module.Result  = Result;
   
  function Bucket(element, prev, next) {
    this.element = element;
    this.next    = next || null;
    this.prev    = prev || null;
  }

  function WorkList() {

    this.length  = 0;
    this.head    = null;
    this.thenloc = null;

  }

  WorkList.prototype.toString = function() {
    var pos = this.head;
    var str = 'worklist:';
    var cnt = 1;
    while (pos) {
      var element = pos.element;
      var line;
      if (typeof element === 'function') {
        line = cnt + ': ' + String(element);
      } else if ('func' in element && 'data' in element) {
        line = cnt + ': ' + String(element.func);
      } else {
        line = cnt + ': ' + element.type + ' ' + pp.pretty(element);
      }

      var ix = line.indexOf('\n');
      if (ix > 0) {
        line = line.slice(0,ix);
      }
       
      str = str + '\n' + line;
      pos = pos.next;
      cnt++;
    }
    return str;
  };

  WorkList.prototype.push = function(element) {
    this.head = new Bucket(element, null, this.head);

    if (this.head.next) {
      this.head.next.prev = this.head;
    }

    this.length++;
  };

  WorkList.prototype.prepend = function(elements) {
    for (var i = elements.length-1; i >= 0; i--) {
      this.push(elements[i]);
    }
  };

  WorkList.prototype.peek = function() {
    return this.head.element;
  };

  WorkList.prototype.pop = function() {
    var element = this.head.element;
    this.head = this.head.next;
    this.length--;
    return element;
  };

  WorkList.prototype.empty = function() {
    return (this.head === null);
  };

  WorkList.prototype.top = function() {
    return new WorkListPtr(this, null);
  };

  WorkList.prototype.first = function(element) {
    if (element) {
      this.push(element);
      this.thenloc = this.head; 
    } else {
      // if no element given, reset thenloc to force next called 'then'
      // to be a 'first'
      this.thenloc = null;
    }
  };

  WorkList.prototype.then = function(element) {
    if (!this.thenloc) {
    
      this.first(element);

    } else {

      var before = this.thenloc;
      var after  = this.thenloc.next;
      
      var bucket = new Bucket(element,before,after);

      before.next  = bucket;
      this.thenloc = before.next;

      if (after) {
        after.prev  = before.next;
      }

      this.length++;
    }
  };

  // -------------------------------------------------------------

  function WorkListPtr(worklist, pos) {
    this.worklist = worklist;
    this.pos = pos;
  }

  WorkListPtr.prototype.then = function(element, data) {
  
    if (!element) {
      throw Error();
    }

    var thing = element;
    if (data) {
      thing = { func : element, data : data };
    }
  
    if (this.pos) {
      var before = this.pos;
      var after  = this.pos.next;

      var bucket = new Bucket(thing,before,after);

      before.next = bucket;
      this.pos    = before.next;

      if (after) {
        after.prev  = before.next;
      }

      this.worklist.length++;

    } else {

      this.worklist.push(thing);
      this.pos = this.worklist.head;

    }

    return this;
  };

  // ------------------------------------------------------------
  // The Completion Specification Type, 8.9

  function Result(value) {
      this.type   = 'normal'; // normal, break, continue, return, throw;
      this.value  = value || null; // null or a value
      this.target = null; // null or a string
  }

  // -------------------------------------------------------------
  // The Execution Context

  function Context(thisValue,variableEnv,lexicalEnv) {
      
      this.thisValue   = thisValue;
      this.variableEnv = variableEnv;
      this.lexicalEnv  = lexicalEnv;

      this.pcStack = new Stack();
      this.pcStack.push(Label.bot);
      
      var _this   = this;
      this.labels = {};
      this.labels.__defineGetter__('pc', function() {
        return _this.pcStack.peek();
      });

      this.labels.__defineSetter__('pc', function(l) {
        _this.pcStack.pop();
        _this.pcStack.push(l);
      });

      this.labels.exc  = Label.bot;
      this.labels.ret  = Label.bot; 

      // statement label map
      this.labels.labelmap = [];


      this.__defineGetter__('effectivePC', function() {

        if (monitor.options.get('monitor.taintMode')) {
          return bot;
        }

        return lub(this.labels.pc, this.labels.exc, this.labels.ret); 
      });


      this.workList     = new WorkList();
      this.result       = new Result();
      this.valueStack   = new Stack();
  }

  Context.prototype.clone = function(thisValue, variableEnv, lexicalEnv) {

    var tV = thisValue || this.thisValue;
    var lE = lexicalEnv || this.lexicalEnv;
    var vE = variableEnv || this.variableEnv;

    var newCtx = new Context(tV,vE,lE);
    newCtx.labels.pc  = this.effectivePC;
    newCtx.labels.exc = this.labels.exc;
    newCtx.labels.ret = this.labels.ret;
    return newCtx;
  };


  Context.prototype.pushPC = function(l) {
    this.pcStack.push(lub(l,this.labels.pc));
  };

  Context.prototype.raisePC = function(l) {
    this.labels.pc = lub(this.labels.pc, l);
  };

  Context.prototype.popPC = function() {
    return this.pcStack.pop();
  };

  Context.prototype.ctx = function() {
    return lub(this.labels.pc, this.labels.exc, this.internal.pc);
  };

  return module;
};

},{}],25:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var Value   = monitor.require('values').Value;
  var Label   = monitor.require('label').Label;
  var bot     = Label.bot;

  var modules = monitor.modules;

  // -------------------------------------------------------------
  
  var module = {};
  module.ToPrimitive          = ToPrimitive;
  module.ToBoolean            = ToBoolean;
  module.ToNumber             = ToNumber;
  module.ToInteger            = ToInteger;
  module.ToInt32              = ToInt32;
  module.ToUInt32             = ToUInt32;
  module.ToUInt16             = ToUInt16;
  module.ToString             = ToString;
  module.ToObject             = ToObject;
  module.CheckObjectCoercible = CheckObjectCoercible;
  module.IsCallable           = IsCallable;
  module.SameValue            = SameValue;
  
  // -------------------------------------------------------------
  // ToPrimitive, 9.1  

  function ToPrimitive(x,PreferredType) {
    if (x.value === null || typeof x.value !== 'object') {
      return x;
    }
    
    // will run int the context of x due to value lifting
    var res = x.DefaultValue(PreferredType);
    return res;
  }

  // -------------------------------------------------------------
  // ToBoolean, 9.2

  function ToBoolean(x) {
    return new Value(Boolean(x.value),x.label); 
  }

  // -------------------------------------------------------------
  // ToNumber, 9.3

  function ToNumber(x) {
    if (typeof x.value !== 'object') {
      return new Value(Number(x.value),x.label);
    }

    monitor.context.pushPC(x.label);
    var primValue = ToPrimitive(x, 'number');
    monitor.context.popPC();

    return new Value(Number(primValue.value), primValue.label);
  }

  // -------------------------------------------------------------
  // ToInteger, 9.4
  //        Using ToNumber to capture the ToPrimitive
  //        and rely on the internal conversion at the point of use
  //        should suffice.

  function ToInteger(x) {
    var number = ToNumber(x);

    var sign = function(n) {
      if(n > 0) {
        return 1;
      }
      else if(n < 0) {
        return -1;
      }

      return 0;
    };

    if(isNaN(number.value)) {
      return new Value(0, number.label);
    }
    else if(number.value === 0 ||
            number.value === Number.POSITIVE_INFINITY ||
            number.value === Number.NEGATIVE_INFINITY) {
      return number;
    }
    else {
      return new Value(
        sign(number.value) * Math.floor(Math.abs(number.value)),
        number.label
      );
    }
  }

  // -------------------------------------------------------------
  // ToInt32, 9.5

  function ToInt32(x) {
    return ToNumber(x);
  }

  // -------------------------------------------------------------
  // ToUInt32, 9.6

  function ToUInt32(x) {
    return ToNumber(x);
  }

  // -------------------------------------------------------------
  // ToUInt16, 9.7

  function ToUInt16(x) {
    var sign = function(n) {
      if(n > 0) {
        return 1;
      }
      else if(n < 0) {
        return -1;
      }

      return 0;
    };

    var number = ToNumber(x);
    if(isNaN(number.value) ||
         number.value === 0 ||
         number.value === Number.POSITIVE_INFINITY ||
         number.value === Number.NEGATIVE_INFINITY) {
      return new Value(0, number.label);
    }

    var posInt = sign(number.value) * Math.floor(Math.abs(number.value));
    var int16bit = posInt % Math.pow(2, 16);
    return new Value(int16bit, number.label);
  }

  // -------------------------------------------------------------
  // ToString, 9.8

  function ToString(x) {
    if (typeof x.value !== 'object') return new Value(String(x.value),x.label);
    
    monitor.context.pushPC(x.label);
    var primValue = ToPrimitive(x, 'string');
    monitor.context.popPC();
    return new Value(String(primValue.value), primValue.label);
  }

  // -------------------------------------------------------------
  // ToObject, 9.9

  function ToObject(x) {
    // null or undefined, hence ==
    if (x.value === null || x.value === undefined) {
      monitor.context.pushPC(x.label);

      monitor.Throw(
        monitor.modules.error.TypeErrorObject,
        'cannot convert ' + String(x.value) + ' to object',
        bot
      );
    }


    var res = new Value(x.value, x.label);
    monitor.context.pushPC(x.label);

      switch (typeof x.value) {
        case 'boolean' :
          res.value = new modules.bool.BooleanObject(x.value,x.label);
        break;
        case 'number' : 
          res.value = new modules.number.NumberObject(x.value,x.label);
        break;
        case 'string' : 
          res.value = new modules.string.StringObject(x.value,x.label);
        break;
      }

    monitor.context.popPC();
    return res;
  }

  // -------------------------------------------------------------
  // CheckObjectCoercible, 9.10

  function CheckObjectCoercible(x) {
    if (x.value === null || x.value === undefined) {
      
      monitor.context.raisePC(x.label);

      monitor.Throw(
        modules.error.TypeErrorObject,
        String(x.value) + ' is not coercible',
        x.label
      );
    }
  }

  // -------------------------------------------------------------
  // IsCallable, 9.11

  function IsCallable(x) {
    var b = false;
    if (x.value !== null && typeof x.value === 'object') {
      b = x.value.Call !== undefined;
    }

    return new Value(b,x.label);
  }

  // -------------------------------------------------------------
  // SameValue, 9.12

  function SameValue(x,y) {
    return (x === y);
  } 


  return module;
};

},{}],26:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {
  
  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var error           = monitor.require('error');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;
  var Unimplemented   = _function.Unimplemented;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;
  var top             = Label.top;

  // ------------------------------------------------------------

  var module = {};
  module.DateObject = DateObject;
  module.allocate = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var dateConstructor = new DateConstructor(host.Date);
    var datePrototype   = dateConstructor._proto;

    return { DateConstructor : dateConstructor,
             DatePrototype   : datePrototype 
           };
  }

  // ------------------------------------------------------------
  // The Date Constructor, 15.9.3

  function DateConstructor(host) {
    Ecma.call(this);

    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Class      = 'Function';
    this.Extensible = true;
    this._proto     = new DatePrototype(this, host);

    this.host       = host;

    ecma.DefineFFF(this , constants.length    , 7);
    ecma.DefineFFF(this , constants.prototype , this._proto);

    ecma.DefineTFT(this , constants.parse     , new BiFO(parse  , 0 , Date.parse));
    ecma.DefineTFT(this , constants.UTC       , new BiFO(UTC    , 0 , Date.UTC));
    ecma.DefineTFT(this , constants.now       , new BiFO(now    , 0 , Date.now));
  }

  prelude.inherits(DateConstructor,Ecma);
  DateConstructor.prototype.HasInstance = _function.HasInstance;

  //----------------------------------------------------
  // 15.9.1.1
  DateConstructor.prototype.Call = function(thisArg,args) {
    var str = monitor.instances.DateConstructor.host();
    return new Value(str,bot);
  };

  //----------------------------------------------------

  // 15.9.3.1
  DateConstructor.prototype.Construct = function(args) {
    var _args = [];
    var label = new Label();
    var obj;
    var _Date = monitor.instances.DateConstructor.host;

    switch (args.length) {

      case 0 :
        obj = new DateObject(new _Date(), top);
        
      break;

      case 1 :
        var v = conversion.ToPrimitive(args[0]);
        if (typeof v.value !== 'string') {
          v = conversion.ToNumber(v);
        }

        obj = new DateObject(new _Date(v.value), v.label);
      break;

      default :
        for (var i = 0, len = args.length; i < len; i++) {
          var val = conversion.ToNumber(args[i]);
          _args[i] = val.value;
          label.lub(val.label);
        }

        if (len == 2) {
          _args[2] = 1;
        }

        for (; i < 7; i++) {
          _args[i] = 0;
        }

        var date = new _Date( 
          _args[0], _args[1], _args[2], _args[3], _args[4], _args[5], _args[6]
        );

        obj = new DateObject(date,label);
    }

    return new Value(obj,bot);
  };
  
  // ------------------------------------------------------------
  // parse, 15.9.4.2
  function parse(thisArg,args) {
    var string = args[0] || new Value(undefined,bot);
    string = conversion.ToString(string);

    var number = monitor.instances.DateConstructor.host.parse(string.value);
    return new Value(number,string.label);
  }

  // ------------------------------------------------------------
  // UTC, 15.9.4.3
  function UTC(thisArg,args) {
    var _args = [];
    var label = new Label();

    for (var i = 0, len = args.length; i < len; i++) {
      var val = conversion.ToNumber(args[i]);
      _args[i] = val.value;
      label.lub(val.label);
    }

    var number = monitor.instances.DateConstructor.host.UTC.apply(null,_args);
    return new Value(number, label);
  }

  // ------------------------------------------------------------
  // now, 15.9.4.4
  function now(thisArg,args) {

    var number = monitor.instances.DateConstructor.host.now();
    return new Value(number, top);

  }

  // ------------------------------------------------------------
  // The Date Prototype, 15.9.5
  function DatePrototype(constructor, _Date) {
    Ecma.call(this);
    this.Class          = 'Date';
    this.PrimitiveValue = new Value(NaN,bot);
    this.Prototype      = new Value(monitor.instances.ObjectPrototype,bot);

    this.host           = _Date.prototype;

    ecma.DefineFFF(this , constants.length           , 0);
    ecma.DefineTFT(this , constants.constructor,constructor);
    ecma.DefineTFT(this , constants.toString           , new BiFO(toString           , 0, _Date.prototype.toString));
    ecma.DefineTFT(this , constants.toDateString       , new BiFO(toDateString       , 0, _Date.prototype.toDateString));
    ecma.DefineTFT(this , constants.toTimeString       , new BiFO(toTimeString       , 0, _Date.prototype.toTimeString));
    ecma.DefineTFT(this , constants.toLocaleString     , new BiFO(toLocaleString     , 0, _Date.prototype.toLocaleString));
    ecma.DefineTFT(this , constants.toLocaleDateString , new BiFO(toLocaleDateString , 0, _Date.prototype.toLocaleDateString));
    ecma.DefineTFT(this , constants.toLocaleTimeString , new BiFO(toLocaleTimeString , 0, _Date.prototype.toLocaleTimeString));
    ecma.DefineTFT(this , constants.valueOf            , new BiFO(valueOf            , 0, _Date.prototype.valueOf));
    ecma.DefineTFT(this , constants.getTime            , new BiFO(getTime            , 0, _Date.prototype.getTime));
    ecma.DefineTFT(this , constants.getFullYear        , new BiFO(getFullYear        , 0, _Date.prototype.getFullYear));
    ecma.DefineTFT(this , constants.getUTCFullYear     , new BiFO(getUTCFullYear     , 0, _Date.prototype.getUTCFullYear));
    ecma.DefineTFT(this , constants.getMonth           , new BiFO(getMonth           , 0, _Date.prototype.getMonth));
    ecma.DefineTFT(this , constants.getUTCMonth        , new BiFO(getUTCMonth        , 0, _Date.prototype.getUTCMonth));
    ecma.DefineTFT(this , constants.getDate            , new BiFO(getDate            , 0, _Date.prototype.getDate));
    ecma.DefineTFT(this , constants.getUTCDate         , new BiFO(getUTCDate         , 0, _Date.prototype.getUTCDate));
    ecma.DefineTFT(this , constants.getDay             , new BiFO(getDay             , 0, _Date.prototype.getDay));
    ecma.DefineTFT(this , constants.getUTCDay          , new BiFO(getUTCDay          , 0, _Date.prototype.getUTCDay));
    ecma.DefineTFT(this , constants.getHours           , new BiFO(getHours           , 0, _Date.prototype.getHours));
    ecma.DefineTFT(this , constants.getUTCHours        , new BiFO(getUTCHours        , 0, _Date.prototype.getUTCHours));
    ecma.DefineTFT(this , constants.getMinutes         , new BiFO(getMinutes         , 0, _Date.prototype.getMinutes));
    ecma.DefineTFT(this , constants.getUTCMinutes      , new BiFO(getUTCMinutes      , 0, _Date.prototype.getUTCMinutes));
    ecma.DefineTFT(this , constants.getSeconds         , new BiFO(getSeconds         , 0, _Date.prototype.getSeconds));
    ecma.DefineTFT(this , constants.getUTCSeconds      , new BiFO(getUTCSeconds      , 0, _Date.prototype.getUTCSeconds));
    ecma.DefineTFT(this , constants.getMilliseconds    , new BiFO(getMilliseconds    , 0, _Date.prototype.getMilliseconds));
    ecma.DefineTFT(this , constants.getUTCMilliseconds , new BiFO(getUTCMilliseconds , 0, _Date.prototype.getUTCMilliseconds));
    ecma.DefineTFT(this , constants.getTimezoneOffset  , new BiFO(getTimezoneOffset  , 0, _Date.prototype.getTimezoneOffset));
    ecma.DefineTFT(this , constants.setTime            , new BiFO(setTime            , 1, _Date.prototype.setTime));
    ecma.DefineTFT(this , constants.setMilliseconds    , new BiFO(setMilliseconds    , 0, _Date.prototype.setMilliseconds));
    ecma.DefineTFT(this , constants.setUTCMilliseconds , new BiFO(setUTCMilliseconds , 0, _Date.prototype.setUTCMilliseconds));
    ecma.DefineTFT(this , constants.setSeconds         , new BiFO(setSeconds         , 0, _Date.prototype.setSeconds));
    ecma.DefineTFT(this , constants.setUTCSeconds      , new BiFO(setUTCSeconds      , 0, _Date.prototype.setUTCSeconds));
    ecma.DefineTFT(this , constants.setMinutes         , new BiFO(setMinutes         , 0, _Date.prototype.setMinutes));
    ecma.DefineTFT(this , constants.setUTCMinutes      , new BiFO(setUTCMinutes      , 0, _Date.prototype.setUTCMinutes));
    ecma.DefineTFT(this , constants.setHours           , new BiFO(setHours           , 0, _Date.prototype.setHours));
    ecma.DefineTFT(this , constants.setUTCHours        , new BiFO(setUTCHours        , 0, _Date.prototype.setUTCHours));
    ecma.DefineTFT(this , constants.setDate            , new BiFO(setDate            , 0, _Date.prototype.setDate));
    ecma.DefineTFT(this , constants.setUTCDate         , new BiFO(setUTCDate         , 0, _Date.prototype.setUTCDate));
    ecma.DefineTFT(this , constants.setMonth           , new BiFO(setMonth           , 2, _Date.prototype.setMonth));
    ecma.DefineTFT(this , constants.setUTCMonth        , new BiFO(setUTCMonth        , 0, _Date.prototype.setUTCMonth));
    ecma.DefineTFT(this , constants.setFullYear        , new BiFO(setFullYear        , 0, _Date.prototype.setFullYear));
    ecma.DefineTFT(this , constants.setUTCFullYear     , new BiFO(setUTCFullYear     , 0, _Date.prototype.setUTCFullYear));
    ecma.DefineTFT(this , constants.toUTCString        , new BiFO(toUTCString        , 0, _Date.prototype.toUTCString));
    ecma.DefineTFT(this , constants.toISOString        , new BiFO(toISOString        , 0, _Date.prototype.toISOString));
    ecma.DefineTFT(this , constants.toJSON             , new BiFO(toJSON             , 0, _Date.prototype.toJSON));

    // B.2.6 - used by google analytics
    ecma.DefineTFT(this , new Value('toGMTString' , bot) , new BiFO(toUTCString , 0, _Date.prototype.toGTMString));
  }

  prelude.inherits(DatePrototype,Ecma);

  function assertDate(v, caller) {
    
    if (v.value === null || typeof v.value !== 'object' || v.value.Class !== 'Date') {
      monitor.context.pushPC(v.label);
      monitor.Throw(
        monitor.modules.error.TypeErrorObject,
        caller + ' is not generic',
        bot
      );
    }

  }

  // ------------------------------------------------------------
  
  function mkGenericGet(fname) {
    return function(thisArg, args) {
      assertDate(thisArg, fname);
      
      var label = lub(thisArg.label, thisArg.value.PrimitiveLabel);
      var date  = thisArg.value.PrimitiveValue;

      var value = date[fname].call(date);

      return new Value(value,label);
    };
  }

  // ------------------------------------------------------------

  function mkGenericSet(fname) {
    return function(thisArg,args) {
      assertDate(thisArg, fname);

      var context = lub(thisArg.label, monitor.context.effectivePC);

      monitor.assert(le(context, thisArg.value.PrimitiveLabel),
        fname + ': context ' + context + ' not below state label of Date object ' + thisArg.value.PrimitiveLabel
      );

      var _args = [];
      var label = new Label();

      for (var i = 0, len = args.length; i < len; i++) {
        var x = conversion.ToNumber(args[i]);
        label.lub(x.label);
        _args[i] = x.value;
      }

      thisArg.value.PrimitiveLabel = lub(thisArg.value.PrimitiveLabel, label);
      label = lub(thisArg.label, thisArg.value.PrimitiveLabel);

      var date  = thisArg.value.PrimitiveValue;
      var value = date[fname].apply(date, _args);

      return new Value(value,label);
    };
  }
  // ------------------------------------------------------------
  // toISOString, 15.9.5.43
  var toISOString = mkGenericGet('toISOString');

  // ------------------------------------------------------------
  // toString, 15.9.5.2
  var toString = mkGenericGet('toString');

  // ------------------------------------------------------------
  // toDateString, 15.9.5.?
  var toDateString = mkGenericGet('toDateString');
  
  // ------------------------------------------------------------
  // toTimeString, 15.9.5.?
  var toTimeString = mkGenericGet('toTimeString');
  
  // ------------------------------------------------------------
  // toLocaleString, 15.9.5.?
  var toLocaleString = mkGenericGet('toLocaleString');
  
  // ------------------------------------------------------------
  // toLocaleDateString, 15.9.5.?
  var toLocaleDateString = mkGenericGet('toLocaleDateString');
  
  // ------------------------------------------------------------
  // toLocaleTimeString, 15.9.5.?
  var toLocaleTimeString = mkGenericGet('toLocaleTimeString');
  
  // ------------------------------------------------------------
  // valueOf, 15.9.5.?
  function valueOf(thisArg, args) {
    assertDate(thisArg, 'valueOf');
    return new Value(thisArg.value.PrimitiveValue.valueOf(), thisArg.label);
  }
  
  // ------------------------------------------------------------
  // getTime, 15.9.5.9
  var getTime = mkGenericGet('getTime');
  
  // ------------------------------------------------------------
  // getFullYear, 15.9.5.?
  var getFullYear = mkGenericGet('getFullYear');
  
  // ------------------------------------------------------------
  // getUTCFullYear, 15.9.5.?
  var getUTCFullYear = mkGenericGet('getUTCFullYear');
  
  // ------------------------------------------------------------
  // getMonth, 15.9.5.?
  var getMonth = mkGenericGet('getMonth');

  // ------------------------------------------------------------
  // getUTCMonth, 15.9.5.?
  var getUTCMonth = mkGenericGet('getUTCMonth');
  
  // ------------------------------------------------------------
  // getDate, 15.9.5.?
  var getDate = mkGenericGet('getDate');

  // ------------------------------------------------------------
  // getUTCDate, 15.9.5.?
  var getUTCDate = mkGenericGet('getUTCDate');
  
  // ------------------------------------------------------------
  // getDay, 15.9.5.?
  var getDay = mkGenericGet('getDay');

  // ------------------------------------------------------------
  // getUTCDay, 15.9.5.?
  var getUTCDay = mkGenericGet('getUTCDay');
  
  // ------------------------------------------------------------
  // getHours, 15.9.5.?
  var getHours = mkGenericGet('getHours');
  
  // ------------------------------------------------------------
  // getUTCHours, 15.9.5.?
  var getUTCHours = mkGenericGet('getUTCHours');

  // ------------------------------------------------------------
  // getMinutes, 15.9.5.?
  var getMinutes = mkGenericGet('getMinutes');
  
  // ------------------------------------------------------------
  // getUTCMinutes, 15.9.5.?
  var getUTCMinutes = mkGenericGet('getUTCMinutes');

  // ------------------------------------------------------------
  // getSeconds, 15.9.5.?
  var getSeconds = mkGenericGet('getSeconds');
  
  // ------------------------------------------------------------
  // getUTCSeconds, 15.9.5.?
  var getUTCSeconds = mkGenericGet('getUTCSeconds');

  // ------------------------------------------------------------
  // getMilliseconds, 15.9.5.?
  var getMilliseconds = mkGenericGet('getMilliseconds');
  
  // ------------------------------------------------------------
  // getUTCMilliseconds, 15.9.5.?
  var getUTCMilliseconds = mkGenericGet('getUTCMilliseconds');
  
  // ------------------------------------------------------------
  // getTimezoneOffset, 15.9.5.?
  var getTimezoneOffset = mkGenericGet('getTimezoneOffset');

  // ------------------------------------------------------------
  // setTime, 15.9.5.?
  var setTime = mkGenericSet('setTime');

  // ------------------------------------------------------------
  // setMilliseconds, 15.9.5.?
  var setMilliseconds = mkGenericSet('setMilliseconds');

  // ------------------------------------------------------------
  // setUTCMilliseconds, 15.9.5.?
  var setUTCMilliseconds = mkGenericSet('setUTCMilliseconds');

  // ------------------------------------------------------------
  // setSeconds, 15.9.5.?
  var setSeconds = mkGenericSet('setSeconds');

  // ------------------------------------------------------------
  // setUTCSeconds, 15.9.5.?
  var setUTCSeconds = mkGenericSet('setUTCSeconds');

  // ------------------------------------------------------------
  // setMinutes, 15.9.5.?
  var setMinutes = mkGenericSet('setMinutes');

  // ------------------------------------------------------------
  // setUTCMinutes, 15.9.5.?
  var setUTCMinutes = mkGenericSet('setUTCMinutes');

  // ------------------------------------------------------------
  // setHours, 15.9.5.?
  var setHours = mkGenericSet('setHours');

  // ------------------------------------------------------------
  // setUTCHours, 15.9.5.?
  var setUTCHours = mkGenericSet('setUTCHours');

  // ------------------------------------------------------------
  // setDate, 15.9.5.?
  var setDate = mkGenericSet('setDate');

  // ------------------------------------------------------------
  // setUTCDate, 15.9.5.?
  var setUTCDate = mkGenericSet('setUTCDate');

  // ------------------------------------------------------------
  // setMonth, 15.9.5.?
  var setMonth = mkGenericSet('setMonth');

  // ------------------------------------------------------------
  // setUTCMonth, 15.9.5.?
  var setUTCMonth = mkGenericSet('setUTCMonth');

  // ------------------------------------------------------------
  // setFullYear, 15.9.5.?
  var setFullYear = mkGenericSet('setFullYear');

  // ------------------------------------------------------------
  // setUTCFullYear, 15.9.5.?
  var setUTCFullYear = mkGenericSet('setUTCFullYear');

  // ------------------------------------------------------------
  // toUTCString, 15.9.5.?
  var toUTCString = mkGenericGet('toUTCString'); 
  
  // ------------------------------------------------------------
  // toJSON, 15.9.5.?
  var toJSON = mkGenericGet('toJSON');

  // ------------------------------------------------------------
  // Date Object, 15.9.5

  function DateObject(date, label) {
    Ecma.call(this);

    this.Class          = 'Date';
    this.PrimitiveValue = date;
    this.PrimitiveLabel = label;
    this.Extensible     = true;
    this.Prototype      = new Value(monitor.instances.DatePrototype,bot);
  }

  prelude.inherits(DateObject,Ecma);

  return module;
};


},{}],27:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var prelude         = monitor.require('prelude');
  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var _               = monitor.require('underscore');

  var Map             = monitor.require('map').Map;
  var Value           = monitor.require('values').Value;

  var Label           = label.Label;
  var lub             = label.lub;
  var glb             = label.glb;
  var le              = label.le;

  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  Object.defineProperty(module, 'PropertyDescriptor', {
    get : 
      function () {
        throw new Error('Access to ecma.PropertyDescriptor');
      }
    }
  );
  Object.defineProperty(module, 'DataProperty', {
    get : 
      function () {
        throw new Error('Access to ecma.DataProperty');
      }
    }
  );
  Object.defineProperty(module, 'AccessorProperty', {
    get : 
      function () {
        throw new Error('Access to ecma.AccessorProperty');
      }
    }
  );
  Object.defineProperty(module, 'APIEcma', {
    get : 
      function () {
        throw new Error('Access to ecma.APIEcma');
      }
    }
  );

  module.Ecma               = Ecma;
  module.Define             = Define;
  module.DefineFFF          = DefineFFF;
  module.DefineTFT          = DefineTFT;
  module.DefineTFF          = DefineTFF;
  module.IsAccessorDescriptor = IsAccessorDescriptor;
  module.IsDataDescriptor = IsDataDescriptor;
  
  // ------------------------------------------------------------
  // Property descriptors, 8.10

  function IsAccessorDescriptor(pd) {
    return ('get' in pd || 'put' in pd);
  }

  function IsDataDescriptor(pd) {
    return ('value' in pd || 'writable' in pd);
  }

  // ------------------------------------------------------------
  // Ecma Objects, 8.6.2

  function Ecma() {
    // return if already initialized
    if (this.ecma) {
      return;
    }
    this.Prototype  = new Value(null,bot);

    this.Class      = undefined;
    this.Extensible = true;

    this.properties = {};
    this.labels     = {};    

    this.struct = monitor.context.effectivePC;

    Object.defineProperty(this, 'map', {
      get : function() {
        throw new Error('Something touched Ecma.map');
      },
      configurable : true
    });
    // this.map    = new Map();

    this.ecma = true;
  }

  Ecma.prototype.raise = function(s,l) {
    throw new Error('Ecma.prototype.raise unimplemented');
  };

  Ecma.prototype.getOwnPropertyNames = function(label) {
    var names  = Object.getOwnPropertyNames(this.properties);
    var result = [];
    var properties = this.properties;

    for (var i = 0, len = names.length; i < len; i++) {
      var name = names[i];
      result[i] = new Value(name, lub(label, this.labels[name].existence));
    }

    return result;
  };


  Ecma.prototype.getOwnEnumerablePropertyNames = function(label) {
    var names = Object.getOwnPropertyNames(this.properties);
    var enumerable = [];
    var j = 0;
    var properties = this.properties;

    for (var i = 0, len = names.length; i < len; i++) {
      var name = names[i];
      var desc = Object.getOwnPropertyDescriptor(properties, name);
      if (desc.enumerable) {
        enumerable[j++] = new Value(name, lub(label, this.labels[name].existence));
      }
    }
    return enumerable;
  };


  Ecma.prototype.getEnumerablePropertyNames = function(initialLabel) {

    var defined = {};
    var result  = [];

    var j = 0; 

    var current = this;
    var lbl = initialLabel || bot;

    while (current) {
      var enumerable = current.getOwnEnumerablePropertyNames(lbl);

      for (var i = 0, len = enumerable.length; i < len; i++) {
        var name = enumerable[i];
        if (!defined.hasOwnProperty(name.value)) {
          defined[name.value] = true;
          result[j++] = name;
        }
      }

      var next = current.Prototype;
      current = next.value;
      lbl = lub(lbl, next.label);
    }

    return result;
  };

  // GetOwnProperty, 8.12.1 -----------------------------------------------------

  Ecma.prototype.GetOwnProperty = function(s) {
    var propName = s.value;
    var propNameLabel = s.label;

    var pd = Object.getOwnPropertyDescriptor(this.properties,propName);

    if (pd === undefined) {
      return new Value(undefined,lub(this.struct,propNameLabel));
    }
    var propLabels = this.labels[propName];
    pd.label       = propLabels.value;

    var result =  new Value(pd,lub(propNameLabel, propLabels.existence));
    return result;
  };  

  // GetProperty, 8.12.2 --------------------------------------------------------

  Ecma.prototype.GetProperty = function(s) {
    var prop = this.GetOwnProperty(s);
    if (prop.value !== undefined) {
      return prop;
    }

    var proto = this.Prototype;
    var lbl   = lub(prop.label,proto.label);

    if (proto.value === null) {
      return new Value(undefined, lbl);
    }
    
    // DEBUG: remove
    if (proto.value === undefined) {
      monitor.fatal('ECMA Object with undefined Prototype');
    }
    
    var res = proto.GetProperty(s);
    res.label = lbl.lub(res.label);
    return res;
  };

  // Get, 8.12.3 ----------------------------------------------------------------
  
  Ecma.prototype.Get = function(s) {


    var desc = this.GetProperty(s);

    if (desc.value === undefined) {
      return desc;
    }

    var v;
    var lbl = desc.label;
    desc = desc.value;


    monitor.context.pushPC(lbl);

    if ('value' in desc) {
      v = new Value(desc.value, desc.label);
    } else if (desc.get) {
      v = desc.get.call(this);
    } else { 
      v = new Value(undefined,lbl);
    }

    monitor.context.popPC();

    v.raise(lbl); 
    return v; 
  };

  // CanPut, 8.12.4 -------------------------------------------------------------

  Ecma.prototype.CanPut = function(p) { 
    var desc = this.GetOwnProperty(p);

    var label = desc.label;

    if (desc.value) {
      desc = desc.value;
      label = lub(label, desc.label);

      if (IsAccessorDescriptor(desc)) {
        return new Value(desc.set !== undefined, label);
      } else {
        return new Value(desc.writable, label);
      }
    }

    var proto = this.Prototype;
    if (proto.value === null) {
      return new Value(this.Extensible, label);
    }

    var inherited = proto.GetProperty(p);
    label = lub(label,inherited.label);

    if (inherited.value === undefined) {
      return new Value(this.Extensible, label);
    }

    inherited = inherited.value;
    label.lub(inherited.label);

    if (IsAccessorDescriptor(inherited)) {
      return new Value(inherited.set !== undefined, label);
    } else {
      if (!this.Extensible) {
        return new Value(false, label);
      } else {
        return new Value(inherited.writable, label);
      }
    }
  };

  // Put, 8.12.5 ----------------------------------------------------------------

  Ecma.prototype.Put = function(s,v,Throw) {
    var c = monitor.context;

    var propName = s.value;
    var propNameLabel = s.label;
    
    var canPut = this.CanPut(s);
    if (!canPut.value) {
      if (Throw) {
        c.pushPC(canPut.label);
        monitor.Throw(
          monitor.modules.error.TypeErrorObject,
          'illegal access',
          bot
        );
      }

      return;
    }

    c.pushPC(new Label());

    var ownDesc = this.GetOwnProperty(s);

    if (ownDesc.value && IsDataDescriptor(ownDesc.value)) {
      this.DefineOwnProperty(s, { value : v.value, label : v.label }, Throw);
      c.popPC();
      return;
    }

    var desc = this.GetProperty(s);
    if (desc.value && IsAccessorDescriptor(desc.value)) {

      this.struct.lub(s.label);
      var valueLabel = this.labels[propName].value;
      
      if (desc.value.set) {
        c.labels.pc.lub(desc.label);

        try {
          desc.value.set.call(this, v);
        } catch(e) {
          monitor.liftException(e,Throw);
        }
        
      }

      c.popPC();
      return;
    }

    c.labels.pc.lub(desc.label);
    this.DefineOwnProperty(s, 
      { value : v.value, 
        label : v.label,
        writable : true,
        enumerable : true,
        configurable : true
      }, Throw);
    c.popPC();
    return;
  };


  // HasProperty, 8.12.6 --------------------------------------------------------

  Ecma.prototype.HasProperty = function(s) {
    var desc = this.GetProperty(s);

    var val = new Value(desc.value !== undefined, desc.label);
    return val;
  };

  // Delete, 8.12.7 -------------------------------------------------------------

  Ecma.prototype.Delete = function(s,Throw) {
    var c = monitor.context;
    var propertyName = s.value;

    var desc = this.GetOwnProperty(s);

    if (desc.value === undefined) {
      return new Value(true, desc.label);
    }

    if (!le(c.effectivePC, this.struct)) {
      var msg = _.template('Ecma.prototype.Delete: security context <%=el%> not below structure <%=sl%>');
      monitor.securityError(msg({el : c.effectivePC, sl : this.struct}));
    }

    var lbl = lub(c.effectivePC, desc.label);
    var existence = this.labels[propertyName].existence;

    if (!le(lbl,existence)) {
      var msg = _.template('Ecma.prototype.Delete: security context <%=el%> not below exstence label <%=sl%>');
      monitor.securityError(msg({el : lbl, sl : existence}));
    }

    var res;
    try {
      res = delete this.properties[propertyName];
      if (res) { 
        delete this.labels[propertyName];
      }
    } catch(e) {
      monitor.liftException(e,Throw);
    }

    return new Value(res, lub(desc.label,existence));
  };

  // DefaultValue, 8.12.8 -------------------------------------------------------

  Ecma.prototype.DefaultValue = function(hint) {
    
    if (hint === undefined) {
      if (this.Class === 'Date')
        hint = 'string';
      else
        hint = 'number';
    }
    
    if (hint === 'string') {
      var toString = this.Get(constants.toString);

      if (conversion.IsCallable(toString).value) {
        var str = toString.Call(new Value(this,bot),[]);

        var type = typeof str.value;
        if (type === 'boolean' || type === 'string' || type === 'number')
          return str;
      }

      monitor.context.pushPC(toString.label);

      var valueOf = this.Get(constants.valueOf);
      if (conversion.IsCallable(valueOf).value) {
        var str = valueOf.Call(new Value(this,bot),[]);
        var type = typeof str.value;
        if (type === 'boolean' || type === 'string' || type === 'number')  {
          str.raise(toString.label);
          monitor.context.popPC();
          return str;
        }
      }

      // return new Value('DefaultValue: unable to convert', bot);
      
      monitor.Throw(
        monitor.modules.error.TypeErrorObject,
        'default value, unable to convert',
        lub(toString.label,valueOf.label)
      );
    }

    // hint must be 'number'

    
    var valueOf = this.Get(constants.valueOf);
    if (conversion.IsCallable(valueOf).value) {
      var str = valueOf.Call(new Value(this,bot),[]);

      var type = typeof str.value;
      if (type === 'boolean' || type === 'string' || type === 'number')  
        return str;
    }

    monitor.context.pushPC(valueOf.label);

    var toString = this.Get(constants.toString);

    if (conversion.IsCallable(toString).value) {
      var str = toString.Call(new Value(this,bot),[]);
      var type = typeof str.value;
      if (type === 'boolean' || type === 'string' || type === 'number') {
        str.raise(valueOf.label);
        monitor.context.popPC();
        return str;
      }
    }

    monitor.Throw(
      monitor.modules.error.TypeErrorObject,
      'default value, unable to convert',
      lub(toString.label,valueOf.label)
    );
  };

  // DefineOwnProperty, 8.12.9 --------------------------------------------------

  Ecma.prototype.DefineOwnProperty = function(s,desc,Throw) {
    var c = monitor.context;
    
    var propName      = s.value;
    var propNameLabel = s.label;
    
    this.struct      = lub(this.struct, propNameLabel);
    var contextLabel = lub(c.effectivePC, propNameLabel);

    try {
      if (Object.hasOwnProperty.call(this.properties,propName)) {
        var valueLabel = this.labels[propName].value;

        if (!le(contextLabel, valueLabel)) {
          var msg = _.template('Ecma.prototype.DefineOwnProperty: security context <%=el%> not below existing value label <%=vl%> for property <%=pn%>');
          monitor.securityError(msg({el : contextLabel, vl : valueLabel, pn : propName})); 
        }

      } else {
        if (!le(c.effectivePC, this.struct)) {
          var msg = _.template('Ecma.prototype.DefineOwnProperty: security context <%=el%> not below structure <%=sl%>');
          monitor.securityError(msg({el : c.effectivePC, sl : this.struct}));
        }
      }

      if (desc.get) {
        var get = desc.get;
        desc.get = function() { return get.Call(new Value(this, bot), []); }; 
        desc.get.actualFunction = get;
      }

      if (desc.set) { 
        var set = desc.set;
        desc.set = function(v) { return set.Call(new Value(this, bot), [v]); };
        desc.set.actualFunction = set;
      }

      Object.defineProperty(this.properties, propName, desc);
      this.labels[propName] = { value : lub(desc.label, contextLabel), existence : contextLabel };

    } catch(e) {
      monitor.liftException(e,Throw);
    }

    return new Value(true,bot);
  };

  // toNative, needed for Tortoise -------------------------------
  Ecma.prototype.toNative = function(deep) {
    var clone = {};
    var lbl = new Label;

    for (x in this.properties) {
      if (this.properties.hasOwnProperty(x)) {
        lbl.lub(this.labels[x].existence, this.labels[x].value);

        var v = this.properties[x];
        var t = typeof v;
        if (t !== 'object' || t !== 'function') {
          clone[x] = v;
        } else {
          // TODO: replace with getter
          clone[x] = null;
        }
      }
    }

    return new Value(clone, lbl);
  };
  
  // ------------------------------------------------------------

  function Define(_this, name, v, opts) {
    opts = opts || {};
    name = name.value || name; 
    
    var pd = { value : v };
    pd.writable = Boolean(opts.writable);
    pd.enumerable = Boolean(opts.enumerable);
    pd.configurable = Boolean(opts.configurable);

    Object.defineProperty(_this.properties, name, pd);
    _this.labels[name] = { value : opts.label || bot, existence : opts.existence || bot };
  }

  function DefineFFF(_this, name, v, opts) {
    opts = opts || {};
    name = name.value || name; 
    Object.defineProperty(_this.properties, name, { value : v });
    _this.labels[name] = { value : opts.label || bot, existence : opts.existence || bot };
  }

  function DefineTFF(_this, name, v, opts) {
    opts = opts || {};
    name = name.value || name; 
    Object.defineProperty(_this.properties, name, 
      { value : v,
        writable : true
      }
    );
    _this.labels[name] = { value : opts.label || bot, existence : opts.existence || bot };
  }

  function DefineTFT(_this, name, v, opts) {
    opts = opts || {};
    name = name.value || name; 
    Object.defineProperty(_this.properties, name, 
      { value : v,
        writable : true,
        configurable : true
      }
    );
    _this.labels[name] = { value : opts.label || bot, existence : opts.existence || bot };
  }

  // ------------------------------------------------------------
  
  return module;
};

},{}],28:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 10.2
exports.functor = function(monitor) {
 
  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');
  var values          = monitor.require('values');

  var Value           = values.Value;
  var Reference       = values.Reference;

  var Ecma            = ecma.Ecma;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;


  // ------------------------------------------------------------  

  var module = {};
  module.ObjectEnvironmentRecord      = ObjectEnvironmentRecord;
  module.DeclarativeEnvironmentRecord = DeclarativeEnvironmentRecord;
  module.LexicalEnvironment           = LexicalEnvironment;
  module.NewDeclarativeEnvironment    = NewDeclarativeEnvironment;
  module.NewObjectEnvironment         = NewObjectEnvironment;
  module.IsEnvironmentRecord          = IsEnvironmentRecord;
  module.GetIdentifierReference       = GetIdentifierReference;

  // ------------------------------------------------------------
  // 10.2.2.2

  function NewDeclarativeEnvironment(e) {
    var envRec = new DeclarativeEnvironmentRecord();
    var env = new LexicalEnvironment(envRec,e);
    return env;
  } 

  // ------------------------------------------------------------
  // 10.2.2.3

  function NewObjectEnvironment(o,e) {
    var envRec = new ObjectEnvironmentRecord(o);
    var env = new LexicalEnvironment(envRec,e);
    return env;
  } 

  // ------------------------------------------------------------
  // Environment records, 10.2.1.2

  function ObjectEnvironmentRecord(p) {
      if (p.value === undefined)
        monitor.fatal('ObjectEnvironmentRecord, undefined binding object');

      Ecma.call(this);
      this.bindingObject = p; // Value
      this.provideThis   = false;
  }

  prelude.inherits(ObjectEnvironmentRecord,Ecma);
  
  ObjectEnvironmentRecord.prototype.raise = function(p,l) {
    this.bindingObject.raise(p,l);
  };

  // HasBinding, 10.2.1.2.1
  ObjectEnvironmentRecord.prototype.HasBinding = function(p) {
      return this.bindingObject.HasProperty(p);
  };

  // CreateMutableBinding, 10.2.1.2.2
  ObjectEnvironmentRecord.prototype.CreateMutableBinding = function(p, d) {
    var desc = { value        : undefined,
                 label        : monitor.context.effectivePC,
                 writable     : true,
                 enumerable   : true,
                 configurable : d
               };

    this.bindingObject.DefineOwnProperty(p, desc, true);
  };

  // GetBindingValue, 10.2.1.2.4
  ObjectEnvironmentRecord.prototype.GetBindingValue = function(p,s) {
    return this.bindingObject.Get(p);
  };

  // SetMutableBinding, 10.2.1.2.3
  ObjectEnvironmentRecord.prototype.SetMutableBinding = function(p,v,s) {
    this.bindingObject.Put(p,v,s);
  };

  // DeleteBinding, 10.2.1.2.5
  ObjectEnvironmentRecord.prototype.DeleteBinding = function(p) {
    return this.bindingObject.Delete(p);
  };

  // ImplicitThisValue, 10.2.1.2.6
  ObjectEnvironmentRecord.prototype.ImplicitThisValue = function() {
    if (this.provideThis) {
      return this.bindingObject.clone();
    } else { 
      return new Value(undefined, bot);
    }
  };

  // ------------------------------------------------------------
  // Declarative Environment Record, 10.2.1.1

  function DeclarativeEnvironmentRecord() {
      Ecma.call(this);
  }
  
  prelude.inherits(DeclarativeEnvironmentRecord,Ecma);

  // HasBinding, 10.2.1.1.1
  DeclarativeEnvironmentRecord.prototype.HasBinding = function(s) {
      return this.HasProperty(s);
  };

  // CreateMutableBinding, 10.2.1.1.2
  DeclarativeEnvironmentRecord.prototype.CreateMutableBinding = function(p,d) {

    var desc = { value        : undefined,
                 label        : monitor.context.effectivePC,
                 writable     : true,
                 enumerable   : true,
                 configurable : d
               };

    this.DefineOwnProperty(p, desc, true);
  };

  // GetBindingValue 10.2.1.1.4
  DeclarativeEnvironmentRecord.prototype.GetBindingValue = function(p,s) {
    return this.Get(p);
  };

  // SetMutableBinding, 10.2.1.1.3
  DeclarativeEnvironmentRecord.prototype.SetMutableBinding = function(p,v,s) {
    this.Put(p,v,s);
  };

  // DeleteBinding, 10.2.1.1.5
  DeclarativeEnvironmentRecord.prototype.DeleteBinding = function(p) {
    return this.Delete(p);
  };

  // ImplicitThisValie. 10.2.1.1.6
  DeclarativeEnvironmentRecord.prototype.ImplicitThisValue = function() {
    return new Value(undefined, bot);
  };

  // CreateImmutableBinding, 10.2.1.1.7
  DeclarativeEnvironmentRecord.prototype.CreateImmutableBinding = function(p) {

    var desc = { value        : undefined,
                 label        : bot,
                 writable     : false,
                 enumerable   : true,
                 configurable : true
               };

    this.DefineOwnProperty(p,desc,false);
  };

  // InitializeImmutableBinding, 10.2.1.1.8
  DeclarativeEnvironmentRecord.prototype.InitializeImmutableBinding = function(p,v) {
    var desc = this.GetOwnProperty(p).value;
    desc.value = v.value;
    desc.label = v.label;
    
    this.DefineOwnProperty(p,desc,false);
  };

  // ------------------------------------------------------------

  function IsEnvironmentRecord(p) {
    return ('HasBinding' in p.value);
  };

  // ------------------------------------------------------------

  function LexicalEnvironment(er,le) {
    this.EnvironmentRecord = er; // Not Value
    this.OuterLexicalEnvironment  = le; // Value
  };

  LexicalEnvironment.prototype.provideThis = function() {
    this.EnvironmentRecord.provideThis = true;
  };

  LexicalEnvironment.prototype.HasBinding = function(s) {
    return this.EnvironmentRecord.HasBinding(s);
  };

  LexicalEnvironment.prototype.CreateMutableBinding = function(s,d) {
    return this.EnvironmentRecord.CreateMutableBinding(s,d);
  };

  LexicalEnvironment.prototype.SetMutableBinding = function(s,v,d) {
    return this.EnvironmentRecord.SetMutableBinding(s,v,d);
  };

  LexicalEnvironment.prototype.GetBindingValue = function(s,d) {
    return this.EnvironmentRecord.GetBindingValue(s,d);
  };

  LexicalEnvironment.prototype.DeleteBinding = function(s) {
    return this.EnvironmentRecord.DeleteBinding(s);
  };

  LexicalEnvironment.prototype.ImplicitThisValue = function() {
    return this.EnvironmentRecord.ImplicitThisValue();
  };
  
  // Only meaningful if the underlying environment record is 
  //  a declarative environment record
  LexicalEnvironment.prototype.CreateImmutableBinding = function(s) {
    return this.EnvironmentRecord.CreateImmutableBinding(s);
  };

  LexicalEnvironment.prototype.InitializeImmutableBinding = function(s,v) {
    return this.EnvironmentRecord.InitializeImmutableBinding(s,v);
  };

  // ------------------------------------------------------------
  // GetIdentifierReference, 10.2.2.1

  function GetIdentifierReference(p,x) {

    if (!p) {
      monitor.fatal('GetIdentifierReference: p undefined or null for ' + x);
    }

    if (p.value == null) {
        return new Reference(new Value(undefined,p.label),
                             new Value(x,bot));
    }
    
    var erp = new Value(p.value.EnvironmentRecord, p.label);

    var b   = erp.HasBinding(new Value(x,bot));
    if (b.value) {
        erp.label = b.label;
        return new Reference(erp, new Value(x,bot));
    }
    else {
        var res = GetIdentifierReference(p.value.OuterLexicalEnvironment, x);
        res.base.raise(b.label);
        return res;
    }
  }

  return module;
};


},{}],29:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {
   
  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.EvalErrorObject      = EvalErrorObject;
  module.RangeErrorObject     = RangeErrorObject;
  module.ReferenceErrorObject = ReferenceErrorObject;
  module.SyntaxErrorObject    = SyntaxErrorObject;
  module.TypeErrorObject      = TypeErrorObject;
  module.URIErrorObject       = URIErrorObject;
  module.ErrorObject          = ErrorObject;
  module.allocate             = allocate;
  module.nativeTable = {
    'EvalError' : EvalErrorObject,
    'RangeError' : RangeErrorObject,
    'ReferenceError' : ReferenceErrorObject,
    'SyntaxError' : SyntaxErrorObject,
    'TypeError' : TypeErrorObject,
    'URIError' : URIErrorObject
  };

  // ------------------------------------------------------------


  function allocate(global) {

    var errorConstructor          = new ErrorConstructor();
    var errorPrototype            = errorConstructor._proto;

    // 15.11.5
    var evalErrorConstructor      = new NativeErrorConstructor(global,'EvalError');
    var rangeErrorConstructor     = new NativeErrorConstructor(global,'RangeError');
    var referenceErrorConstructor = new NativeErrorConstructor(global,'ReferenceError');
    var syntaxErrorConstructor    = new NativeErrorConstructor(global,'SyntaxError');
    var typeErrorConstructor      = new NativeErrorConstructor(global,'TypeError');
    var URIErrorConstructor       = new NativeErrorConstructor(global,'URIError');

    var evalErrorPrototype        = evalErrorConstructor._proto;
    var rangeErrorPrototype       = rangeErrorConstructor._proto;
    var referenceErrorPrototype   = referenceErrorConstructor._proto;
    var syntaxErrorPrototype      = syntaxErrorConstructor._proto;
    var typeErrorPrototype        = typeErrorConstructor._proto;
    var uriErrorPrototype         = URIErrorConstructor._proto;

    return { ErrorConstructor          : errorConstructor,
             ErrorPrototype            : errorPrototype,
             EvalErrorConstructor      : evalErrorConstructor,
             EvalErrorPrototype        : evalErrorPrototype,
             RangeErrorConstructor     : rangeErrorConstructor,
             RangeErrorPrototype       : rangeErrorPrototype,
             ReferenceErrorConstructor : referenceErrorConstructor,
             ReferenceErrorPrototype   : referenceErrorPrototype,
             SyntaxErrorConstructor    : syntaxErrorConstructor,
             SyntaxErrorPrototype      : syntaxErrorPrototype,
             TypeErrorConstructor      : typeErrorConstructor,
             TypeErrorPrototype        : typeErrorPrototype,
             URIErrorConstructor       : URIErrorConstructor,
             URIErrorPrototype         : uriErrorPrototype
    };
  }

  // ------------------------------------------------------------
  // 15.11 - The Error Constructor

  function ErrorConstructor(host) {
    Ecma.call(this);

    this.Class      = 'Function';
    this.host       = host;
    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Extensible = true;
    this.name       = 'Error';

    this._proto     = new ErrorPrototype(this);

    ecma.DefineFFF(this,constants.length,1);
    ecma.DefineFFF(this,constants.prototype,this._proto);
  }

  prelude.inherits(ErrorConstructor,Ecma);

  ErrorConstructor.prototype.HasInstance = _function.HasInstance;

  // 15.11.2
  ErrorConstructor.prototype.Call = function(thisArg,args) {
    return this.Construct(args);
  };

  // 15.11.2.1
  ErrorConstructor.prototype.Construct = function(args) {
    var arg0 = args[0] ? args[0] : new Value(undefined,bot);
    var o = new ErrorObject(arg0);
    return new Value(o,bot);
  };
    
  // ------------------------------------------------------------
  // 15.11.4 The Error Prototype

  function ErrorPrototype(constructor) {
    Ecma.call(this);

    this.Class     = 'Error';
    this.Prototype = new Value(monitor.instances.ObjectPrototype,bot);
    
    ecma.DefineTFT(this,constants.constructor,constructor);
    ecma.DefineTFT(this,constants.name, 'Error');
    ecma.DefineTFT(this,constants.message, '');

    ecma.DefineTFT(this , constants.toString , new BiFO(ToString, 0, undefined));   
  }

  prelude.inherits(ErrorPrototype,Ecma);

  // ------------------------------------------------------------

  function ToString(thisArg, args) {
    var c = monitor.context;

    if (  thisArg.value === null 
       || typeof thisArg.value !== 'object' 
       || thisArg.value.Class !== 'Error' ) {

      c.pushPC(thisArg.label);
      monitor.Throw(
        TypeErrorObject,
        'Error object expected',
        bot
      );
    }

    var name = thisArg.Get(constants.name);

    if (name.value === undefined)  {
      name.value = 'Error';
    } else {
      c.pushPC(name.label);
        name = conversion.ToString(name);
      c.popPC();
    }

    var msg = thisArg.Get(constants.message);

    if (msg.value === undefined) {
      msg.value = '';
    } else {
      c.pushPC(msg.label);
        msg = conversion.ToString(msg);
      c.popPC();
    }

    if (name.value === '') {
      msg.raise(name.label);
      return msg;
    }

    if (msg.value === '') {
      name.raise(msg.label);
      return name;
    }

    name.value += ': ' + msg.value;
    name.raise(msg.label);
    return name;
  }

  // ------------------------------------------------------------

  function ErrorObject(v) {
    Ecma.call(this);

    this.Prototype  = new Value(monitor.instances.ErrorPrototype, bot);
    this.Class      = 'Error';
    this.Extensible = true;

    if (v.value !== undefined)  {
      v = conversion.ToString(v);
      this.DefineOwnProperty(
        constants.message,
        { value        : v.value,
          label        : v.label,
          writable     : true,
          enumerable   : false,
          configurable : true
        }
      );
    }
  }

  prelude.inherits(ErrorObject,Ecma);

  ErrorObject.prototype.toString = function() {
    var str = ToString(new Value(this, bot));
    return str.value;
  };

  // ------------------------------------------------------------
  // 15.11.7 The NativeError Constructor

  function NativeErrorConstructor(global,name) {
    Ecma.call(this);

    this.Class      = 'Function';
    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Extensible = true;

    this.name       = name;
    this.host       = global[name];

    this._proto     = new NativeErrorPrototype(this,name);

    ecma.DefineFFF(this,constants.length,1);
    ecma.DefineFFF(this,constants.prototype,this._proto);

  }

  prelude.inherits(NativeErrorConstructor,Ecma);
  
  NativeErrorConstructor.prototype.HasInstance = _function.HasInstance;

  // 15.11.7.2
  NativeErrorConstructor.prototype.Call = function(thisArg,args) {
    return this.Construct(args);
  };

  // 15.11.7.4
  NativeErrorConstructor.prototype.Construct = function(args) {
    var message = args[0] || new Value(undefined,bot);
    var o = new NativeErrorObject(this._proto,message);
    return new Value(o,bot);
  };

  // ------------------------------------------------------------
  // 15.11.7.6 The NativeError Prototype

  function NativeErrorPrototype(constructor,name) {
    Ecma.call(this);

    this.Class     = 'Error';
    this.Prototype = new Value(monitor.instances.ObjectPrototype,bot);
      
    ecma.DefineTFT(this, constants.constructor,constructor); 
    ecma.DefineTFT(this, constants.name, name);
    ecma.DefineTFT(this, constants.message, ''); 
    ecma.DefineTFT(this, constants.toString , new BiFO(ToString, 0, undefined));   
  }

  prelude.inherits(NativeErrorPrototype,Ecma);
    
  // ------------------------------------------------------------
  function NativeErrorObject(proto,message) {
    Ecma.call(this);
    this.Prototype  = new Value(proto, bot);
    this.Class      = 'Error';
    this.Extensible = true;
  
    this.stack = monitor.stackTrace();
    
    if (message.value !== undefined)  {
      message = conversion.ToString(message);
      
      this.DefineOwnProperty(constants.message,
        { value        : message.value,
          writable     : true,
          configurable : true,
          label        : message.label
        }
      );
    }
  
  }

  prelude.inherits(NativeErrorObject,Ecma);
  
  NativeErrorObject.prototype.toString = function() {
    var str = ToString(new Value(this, bot));
    return str.value;
  };

  // -------------------------------------------------------------------------- 

  function EvalErrorObject(v) {
    NativeErrorObject.call(this,monitor.instances.EvalErrorPrototype,v);
    this.Type = 'EvalError';
  }
  prelude.inherits(EvalErrorObject,NativeErrorObject);

  function RangeErrorObject(v) {
    NativeErrorObject.call(this,monitor.instances.RangeErrorPrototype,v);
    this.Type = 'RangeError';
  }
  prelude.inherits(RangeErrorObject,NativeErrorObject);

  function ReferenceErrorObject(v) {
    NativeErrorObject.call(this,monitor.instances.ReferenceErrorPrototype,v);
    this.Type = 'ReferenceError';
  }
  prelude.inherits(ReferenceErrorObject,NativeErrorObject);

  function SyntaxErrorObject(v) {
    NativeErrorObject.call(this,monitor.instances.SyntaxErrorPrototype,v);
    this.Type = 'SyntaxError';
  }
  prelude.inherits(SyntaxErrorObject,NativeErrorObject);

  function TypeErrorObject(v) {
    NativeErrorObject.call(this,monitor.instances.TypeErrorPrototype,v);
    this.Type = 'TypeError';
  }
  prelude.inherits(TypeErrorObject,NativeErrorObject);

  function URIErrorObject(v) {
    NativeErrorObject.call(this,monitor.instances.UriErrorPrototype,v);
    this.Type = 'URIError';
  }
  prelude.inherits(URIErrorObject,NativeErrorObject);

  // -------------------------------------------------------------------------- 
  
  return module;
};

},{}],30:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var esprima    = monitor.require('esprima');

  var Set        = monitor.require('set').Set;

  var label      = monitor.require('label');
  var conversion = monitor.require('conversion');
  var constants  = monitor.require('constants');
  var prelude    = monitor.require('prelude');
  var ecma       = monitor.require('ecma');
  var _function  = monitor.require('function');
  var env        = monitor.require('env');
  var error      = monitor.require('error');
  var object     = monitor.require('object');
  var array      = monitor.require('array');
  var pp         = monitor.require('pp');
  var regexp     = monitor.require('regexp');

  var Value        = monitor.require('values').Value;
  var Reference    = monitor.require('values').Reference;
  var Result       = monitor.require('context').Result;
  var RegExpObject = regexp.RegExpObject;

  var Label      = label.Label;
  var lub        = label.lub;
  var le         = label.le;
  var bot        = Label.bot;

  // ------------------------------------------------------------

  var runfor_all            = { 'throw' : true, 'continue' : true, 'break' : true };
  var runfor_throw          = { 'throw' : true };
  var runfor_continue       = { 'continue' : true };
  var runfor_break          = { 'break' : true } ;
  var runfor_continue_break = { 'break' : true, 'continue' : true };

  // ------------------------------------------------------------
  
  var module = {};
  module.initialize        = initialize;
  module.execute           = execute;
  module.executeGlobalCode = executeGlobalCode;
  module.resume            = resume;
  module.running           = running;

  // ------------------------------------------------------------

  function initialize() {
    
    var global     = monitor.instances.globalObject;
    var globalEnv  = env.NewObjectEnvironment(new Value(global,bot), new Value(null,bot));
    
    monitor.instances.globalEnvironment = globalEnv;
    monitor.context.thisValue   = new Value(global,bot);
    monitor.context.variableEnv = new Value(globalEnv,bot);
    monitor.context.lexicalEnv  = new Value(globalEnv,bot);

  }

  // ------------------------------------------------------------

  function running() {
    return !monitor.context.workList.empty(); 
  }

  // ------------------------------------------------------------

  function execute(ast,debugEnabled) {

    monitor.context.workList.push(ast);
    monitor.context.result = new Result();

    if (debugEnabled === undefined) {
      debugEnabled = true;
    }

    var cont = true;
    do {
      if (debugEnabled && monitor.debug.active) {
        return monitor.context.result;
      }
      cont = step();
    } while(cont);

    return monitor.context.result;
  }

  // ------------------------------------------------------------

  function resume() {

    var cont = true;
    do {
      cont = step();
      if (monitor.debug.active) {
        return monitor.context.result;
      }
    } while(cont);

    return monitor.context.result;
  }

  // ------------------------------------------------------------

  function executeGlobalCode(code, filename, options) {
    try {
      monitor.code = code;
      monitor.ast = esprima.parse(code, { loc : true, range : true, tolerant : true,  source : filename });

    } catch (e) {
      var msg = e.description + ' in ' + filename + ':' + e.lineNumber + ':' + e.column;
      msg = new Value(msg, bot);

      var obj      = new error.SyntaxErrorObject(msg, bot);
      var result   = new Result();
      result.type  = 'throw';
      result.value = new Value(obj, bot);
      return result;
    }

    var debugEnabled = true;
    if (options && typeof options.debugEnabled !== 'undefined') {
      debugEnabled = options.debugEnabled;
    }
    
    enterGlobalCode(monitor.ast);
    return execute(monitor.ast,debugEnabled);
  }
  
  // ------------------------------------------------------------
  //   contains the declaration binding (10.5) of global code
 
  function enterGlobalCode(ast, filename) {

    var c = monitor.context;

    // 10.5 - hoisting
    _function.HoistFunctions(c.variableEnv, ast, false, bot);
    _function.HoistVariables(c.variableEnv, ast, false, bot);

  }

  // ------------------------------------------------------------
  // GetValue, 8.7.1

  function GetValue(v) {
    if (!v || ! (v instanceof Reference)) return v;

    if (v.base.label === undefined) 
      monitor.fatal('GetValue, base.label undefined');

    if (v.IsUnresolvableReference()) {
      monitor.Throw(error.ReferenceErrorObject,
        v.propertyName.value + ' not defined',
        v.base.label
      );
    }
    
    var p = v.base;
    var s = v.propertyName;

    if (v.IsPropertyReference()) {
      if (!v.HasPrimitiveBase()) {
        return p.Get(s);
      }
      else {
        var o = conversion.ToObject(p);
        var desc = o.GetProperty(s);

        if (desc.value === undefined) { 
          return desc;
        }
       
        var lbl = new Label();
        lbl.lub(desc.label, desc.value.label);
        desc = desc.value;
        
        if (ecma.IsDataDescriptor(desc)) {
          return new Value(desc.value,lbl);
        }

        var get = desc.get;
        if (get === undefined) { 
          new Value(undefined,lbl);
        }

        monitor.context.pushPC(lbl);
          var res = get.Call(get,v.base);
        monitor.context.popPC();

        res.raise(lbl);
        return res;
      }
    }

    return p.GetBindingValue(s);
  }
 
  // ------------------------------------------------------------
  // PutValue

  function PutValue(r,v) {
      var ctx = monitor.context;

      if (! (r instanceof Reference) ) {
        throw new Error();
        monitor.Throw(
          error.ReferenceErrorObject,
          'PutValue: target is not a reference',
          r.label
        );
      }
      
      var p = r.base;
      var s = r.propertyName;
     
      if (r.IsUnresolvableReference()) {
        p.value = monitor.instances.globalObject;
        p.Put(s,v);
      } else if (r.IsPropertyReference()) {
        if (r.HasPrimitiveBase()) {
          var o = conversion.ToObject(p);
          if (!o.CanPut(s).value) {
            return;
          }

          var ownDesc = o.GetOwnProperty(s);
          if (ownDesc.value && ecma.IsDataDescriptor(ownDesc.value)) {
            return;
          }

          var desc = o.GetProperty(s);
          if (desc.value && ecma.IsAccessorDescriptor(desc.value)) {
            monitor.context.pushPC(lub(ownDesc.label, desc.label)); // contains o.label
              desc.value.Set.Call(p, [v]);  
            monitor.context.popPC();
          }

        } else {
          p.Put(s,v);
        }
      } else {
          p.SetMutableBinding(s,v);
      }
  }
  
  // -------------------------------------------------------------
  // Unary operators


  // -------------------------------------------------------------
  // Unary -, 11.4.7

  function unaryMinus(wl,vs) {
    var ref = vs.pop();
    var n   = conversion.ToNumber(GetValue(ref));
    n.value = -n.value;
    vs.push(n);
  }

  // -------------------------------------------------------------
  // Unary +, 11.4.6

  function unaryPlus(wl,vs) {
    var ref = vs.pop();
    var n = conversion.ToNumber(GetValue(ref));
    vs.push(n);
  }

  // -------------------------------------------------------------
  // Logical NOT, 11.4.9

  function unaryLogicalNot(wl,vs) {
    var ref = vs.pop();
    var b = conversion.ToBoolean(GetValue(ref));
    b.value = !b.value;
    vs.push(b);
  }

  // -------------------------------------------------------------
  // Bitwise NOT, 11.4.8

  function unaryBitwiseNot(wl,vs) {
    var ref = vs.pop();
    var n = conversion.ToInt32(GetValue(ref));
    n.value = ~n.value;
    vs.push(n);
  }

  // -------------------------------------------------------------
  // The typeof Operator, 11.4.3

  function unaryTypeof(wl,vs) {
    var ref = vs.pop();
    var isRef = (ref instanceof Reference);

    if (isRef && ref.IsUnresolvableReference()) {
      vs.push(new Value('undefined', ref.base.label));
    } else {

      var val;        

      if (isRef) {
        val = GetValue(ref);
      } else {
        val = ref;
      }
      
      if (val.value === null) {
        vs.push(new Value('object',val.label));
        return;
      }

      if (typeof val.value === 'object') {

        if ('Call' in val.value) {
          vs.push(new Value('function', val.label));
        } else {
          vs.push(new Value('object', val.label));
        }

      } else {
        vs.push(new Value(typeof val.value, val.label));
      }
    }
  
  }

  // -------------------------------------------------------------
  // The void Operator, 11.4.2
  
  function unaryVoid(wl,vs) {
    var ref = vs.pop();
    var _ignore = GetValue(ref);
    vs.push(new Value(undefined, bot));
  }

  // -------------------------------------------------------------
  // The delete Operator, 11.4.1
  
  function unaryDelete(wl,vs) {
    var ref = vs.pop();

    if (ref instanceof Reference) {

      if (ref.IsUnresolvableReference()) {
        vs.push(new Value(true, ref.base.label));
      } else {

        if (ref.IsPropertyReference()) {
          var object = conversion.ToObject(ref.base);
          vs.push(object.Delete(ref.propertyName));
        } else {
          vs.push(ref.base.DeleteBinding(ref.propertyName));
        }
      }

    } else {
      vs.push(new Value(true, ref.label));
    }
  }

  // -------------------------------------------------------------

  var unarytbl = {
    '-'      : unaryMinus,
    '+'      : unaryPlus,
    '!'      : unaryLogicalNot,
    '~'      : unaryBitwiseNot,
    'typeof' : unaryTypeof,
    'void'   : unaryVoid,
    'delete' : unaryDelete
  };

  
  // -------------------------------------------------------------
  // Equality Operators, 11.9

  function binaryEqs(op,wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    var res;

    while (true) {
      var lt = typeof lval.value;
      var rt = typeof rval.value;

      lt = lval.value === undefined ? 'undefined' : lt;
      rt = rval.value === undefined ? 'undefined' : rt;

      lt = lval.value === null ? 'null' : lt;
      rt = rval.value === null ? 'null' : rt;

      // must use strict in order not to trigger conversion
      //   but then null and undefined must be handled separately
      if (lt === rt) {
        res = new Value(lval.value === rval.value,
                      lub(lval.label,rval.label));
        break;
      }
    
      if ((lval.value === null && rval.value === undefined) ||
          (lval.value === undefined && rval.value === null)) {
        res = new Value(true, lub(lval.label,rval.label));
        break;
      }

      if (lt === 'number' && rt === 'string') {
        rval = conversion.ToNumber(rval);
        continue;
      }

      if (lt === 'string' && rt === 'number') {
        lval = conversion.ToNumber(lval);
        continue;
      }

      if (lt === 'boolean') {
        lval = conversion.ToNumber(lval);
        continue;
      }

      if (rt === 'boolean') {
        rval = conversion.ToNumber(rval);
        continue;
      }

      if ((lt === 'string' || lt === 'number') &&
          rt === 'object') {
        rval = conversion.ToPrimitive(rval);
        continue;
      }

      if (lt === 'object' && 
          (rt === 'string' || rt === 'number')) {
        lval = conversion.ToPrimitive(lval);
        continue;
      }
      res = new Value(false, lub(lval.label,rval.label));
      break;
    }
  
    if (op === '!=') {
      res.value = !res.value;
    }

    vs.push(res);
  }

  // -------------------------------------------------------------
  // Strict Equality Operators, 11.9.4, 11.9.5
  
  function binaryStrictEqs(op,wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();
    var res = new Value(lval.value === rval.value,
                        lub(lval.label,rval.label));

    if (op === '!==') {
      res.value = !res.value;
    }

    vs.push(res);
  }

  // -------------------------------------------------------------
  // Relational Operators, 11.8
  //  The evaluation order is important, 11.8.5

  function binaryOrds(op,wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    var lprim = conversion.ToPrimitive(lval);
    var rprim = conversion.ToPrimitive(rval);

    var res;

    if (typeof lprim.value !== 'string' &&
        typeof rprim.value !== 'string') {
      var lnum = conversion.ToNumber(lprim);
      var rnum = conversion.ToNumber(rprim);
      var val  = eval('lnum.value ' + op + ' rnum.value');
      res = new Value(val, lub(lnum.label,rnum.label));
    } else {
      var val = eval('lprim.value ' + op + ' rprim.value');
      res = new Value(val, lub(lprim.label,rprim.label));
    }

    vs.push(res);
  }

  // -------------------------------------------------------------
  // Bitwise Shift Operators, 11.7

  function binaryShifts(op,wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    var lnum = (op === '>>>') ? conversion.ToUInt32(lval) : conversion.ToInt32(lval);
    var rnum = conversion.ToUInt32(rval);
    var val  = eval('lnum.value ' + op + ' rnum.value');
    
    vs.push(new Value(val, lub(lnum.label,rnum.label)));
  }

  // -------------------------------------------------------------
  // Binary Bitwise Operators, 11.10

  function binaryBitwiseOps(op,wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    var lnum = conversion.ToInt32(lval);
    var rnum = conversion.ToInt32(rval);
    var val  = eval('lnum.value ' + op + ' rnum.value');

    vs.push(new Value(val, lub(lnum.label,rnum.label)));
  }

  // -------------------------------------------------------------
  // Plus, 11.6

  function binaryPlus(wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    var lprim = conversion.ToPrimitive(lval);
    var rprim = conversion.ToPrimitive(rval);
    var res;

    if ((typeof lprim.value) === 'string' ||
        (typeof rprim.value) === 'string') {
      var lstr = conversion.ToString(lprim);
      var rstr = conversion.ToString(rprim);
      res = new Value(lstr.value + rstr.value, 
                    lub(lprim.label,rprim.label));
    } else {
      var lnum = conversion.ToNumber(lprim);
      var rnum = conversion.ToNumber(rprim);
      res = new Value(lnum.value + rnum.value,
                    lub(lnum.label,rnum.label));
    }

    vs.push(res);
  }

  // -------------------------------------------------------------
  // Multiplicative operators, 11.5, and minus, 11.6

  function binaryArithmeticOps(op,wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    var leftNum  = conversion.ToNumber(lval);
    var rightNum = conversion.ToNumber(rval);
    var val      = eval('leftNum.value ' + op + ' rightNum.value');

    vs.push(new Value(val, lub(leftNum.label,rightNum.label)));
  }

  // -------------------------------------------------------------
  // The in operator, 11.8.7

  function binaryIn(wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    if (typeof rval.value !== 'object') {
      if (false) { // SILENT ERROR
        vs.push(new Value(false, lub(lval.label,rval.label)));
        return;
      }

      monitor.Throw(
        error.TypeErrorObject,
        "invalid 'in' parameter",
        rval.label
      );
    }
    vs.push(rval.HasProperty(conversion.ToString(lval)));
  }

  // -------------------------------------------------------------
  // The instanceof operator, 11.8.6

  function binaryInstanceof(wl,vs) {
    var rval = vs.pop();
    var lval = vs.pop();

    if (typeof rval.value !== 'object') {
      if (false) { // SILENT ERROR
        vs.push(new Value(false, lub(lval.label,rval.label)));
      } 

      monitor.Throw(
        error.TypeErrorObject,
        "invalid 'instanceof' parameter",
        rval.label
      );
    }

    if (! ('HasInstance' in rval.value)) {
      if (false) { // SILENT ERROR
        vs.push(new Value(false, lub(lval.label,rval.label)));
      }

      monitor.Throw(
        error.TypeErrorObject,
        "invalid 'instanceof' parameter",
        rval.label
      );
    }

    vs.push(rval.HasInstance(lval));
  }

  // -------------------------------------------------------------

  var binarytbl = {
    '=='         : binaryEqs.bind(null,'=='),
    '!='         : binaryEqs.bind(null,'!='),
    '==='        : binaryStrictEqs.bind(null,'==='),
    '!=='        : binaryStrictEqs.bind(null,'!=='),
    '<'          : binaryOrds.bind(null,'<'),
    '<='         : binaryOrds.bind(null,'<='),
    '>'          : binaryOrds.bind(null,'>'),
    '>='         : binaryOrds.bind(null,'>='),
    '<<'         : binaryShifts.bind(null,'<<'),
    '>>'         : binaryShifts.bind(null,'>>'),
    '>>>'        : binaryShifts.bind(null,'>>>'),
    '+'          : binaryPlus,
    '-'          : binaryArithmeticOps.bind(null,'-'),
    '*'          : binaryArithmeticOps.bind(null,'*'),
    '/'          : binaryArithmeticOps.bind(null,'/'),
    '%'          : binaryArithmeticOps.bind(null,'%'),
    '|'          : binaryBitwiseOps.bind(null,'|'),
    '&'          : binaryBitwiseOps.bind(null,'&'),
    '^'          : binaryBitwiseOps.bind(null,'^'),
    'in'         : binaryIn,
    'instanceof' : binaryInstanceof
  };
  

  // ------------------------------------------------------------- 
  // Prefix, and Postfix Expressions, 11.3, 11.4.4, 11.4.5

  function prefixOps(op,wl,vs) {
    var ref      = vs.pop();
    var oldValue = conversion.ToNumber(GetValue(ref));
    var val      = op === '++' ? oldValue.value + 1 : oldValue.value - 1;
    var newValue = new Value(val, oldValue.label); 
    PutValue(ref, newValue);

    vs.push(newValue);
  }

  function postfixOps(op,wl,vs) {
    var ref      = vs.pop();
    var oldValue = conversion.ToNumber(GetValue(ref));
    var val      = op === '++' ? oldValue.value + 1 : oldValue.value - 1;
    var newValue = new Value(val, oldValue.label); 
    PutValue(ref, newValue);

    vs.push(oldValue);
  }

  // -------------------------------------------------------------

  var prefixtbl = {
    '++' : prefixOps.bind(null,'++'),
    '--' : prefixOps.bind(null,'--')
  };

  var postfixtbl = {
    '++' : postfixOps.bind(null,'++'),
    '--' : postfixOps.bind(null,'--')
  };

  // -------------------------------------------------------------
  // Binary Logical ||, 11.11

  function binaryLogicalOr(wl,vs) {

    var lval = GetValue(vs.pop());
    vs.push(lval);

    var lb   = conversion.ToBoolean(lval);
    var right = wl.pop();

    if (lb.value) {
      return;
    }

    monitor.context.pushPC(lb.label);

    var ip = wl.top();
    ip.then(right);
    ip.then(binaryLogicalOr_end);
  }    
    
  function binaryLogicalOr_end(wl,vs) {
    var rval = GetValue(vs.pop());
    var lval = vs.pop();

    monitor.context.popPC();
  
    vs.push(new Value(rval.value, lub(rval.label,lval.label)));
  }
     
  // -------------------------------------------------------------
  // Binary Logical &&, 11.11

  function binaryLogicalAnd(wl,vs) {
    var lval = GetValue(vs.pop());
    vs.push(lval);
    var lb   = conversion.ToBoolean(lval);
    var right = wl.pop();

    if (!lb.value) {
      return;
    }

    monitor.context.pushPC(lb.label);

    var ip = wl.top();
    ip.then(right);
    ip.then(binaryLogicalAnd_end);
  }

  function binaryLogicalAnd_end(wl,vs) {
    var rval = GetValue(vs.pop());
    var lval = vs.pop();
    
    monitor.context.popPC();

    vs.push(new Value(rval.value, lub(rval.label,lval.label)));
  }

  // -------------------------------------------------------------

  var logicaltbl = {
    '||' : binaryLogicalOr,
    '&&' : binaryLogicalAnd
  };

  // -------------------------------------------------------------
  
  function assignmentOps(op,wl,vs) {
    var rval = GetValue(vs.pop());
    var lref = vs.pop();

    if (op) {
      vs.push(lref);
      vs.push(GetValue(lref));
      vs.push(rval);
      binarytbl[op](wl,vs);
    } else {
      vs.push(lref);
      vs.push(rval);
    }
  }

  var assignmenttbl = {
    '='    : assignmentOps.bind(null,null),
    '+='   : assignmentOps.bind(null,'+'),
    '-='   : assignmentOps.bind(null,'-'),
    '*='   : assignmentOps.bind(null,'*'),
    '/='   : assignmentOps.bind(null,'/'),
    '%='   : assignmentOps.bind(null,'%'),
    '>>='  : assignmentOps.bind(null,'>>'),
    '<<='  : assignmentOps.bind(null,'<<'),
    '>>>=' : assignmentOps.bind(null,'>>>'),
    '|='   : assignmentOps.bind(null,'|'),
    '&='   : assignmentOps.bind(null,'&'),
    '^='   : assignmentOps.bind(null,'^')
  };

  // -------------------------------------------------------------

  function _GetValue() {
    var vs    = monitor.context.valueStack;
    vs.push(GetValue(vs.pop()));
  }

  function _popPC() {
    monitor.context.popPC();
  }
  
  _popPC.runfor = runfor_continue_break;

  // -------------------------------------------------------------
  // expression handler functions 
  
  var expressiontbl = {
    'ThisExpression'        : thisExpression,
    'ArrayExpression'       : arrayExpression,
    'ObjectExpression'      : objectExpression,
    'FunctionExpression'    : functionExpression,
    'SequenceExpression'    : sequenceExpression,
    'UnaryExpression'       : unaryExpression,
    'BinaryExpression'      : binaryExpression,
    'UpdateExpression'      : updateExpression,
    'LogicalExpression'     : logicalExpression,
    'AssignmentExpression'  : assignmentExpression,
    'ConditionalExpression' : conditionalExpression,
    'NewExpression'         : newExpression,
    'CallExpression'        : callExpression,
    'MemberExpression'      : memberExpression,
    'Identifier'            : identifierExpression,
    'Literal'               : literalExpression
  };

  // This, 11.1.1 -------------------------------------------- 
  
  function thisExpression(node,wl,vs) {
    var c = monitor.context;
    vs.push(c.thisValue.clone());
  }

  // Array Initializer, 11.1.4 -------------------------------
 
  function arrayExpression(node,wl,vs) {
    var ip = wl.top();

    var arr = new Value(new array.ArrayObject(),bot);
    var es  = node.elements;
    var len = es.length;

    arr.Put(constants.length, new Value(len,bot));
    vs.push(arr);
  
    for (var i = 0; i < len; i++) {
      if (es[i]) {
        ip.then(es[i]);
        ip.then(arrayExpressionUpdate, { array : arr, index : i });
      }
    }
  }

  // arrayExpressionUpdate

  function arrayExpressionUpdate(wl,vs) {
    var initValue = GetValue(vs.pop()); 
    this.array.Put(new Value(this.index,bot), initValue);
  }

  // Object Initializer, 11.1.5 ------------------------------

  function objectExpression(node,wl,vs) {
    var ip = wl.top();

    var obj = new Value(new object.ObjectObject(),bot);
    vs.push(obj);

    var ps  = node.properties;
    
    for (var i = 0, len = ps.length; i < len; i++) {
      ip.then(ps[i].value);
      ip.then(objectExpressionUpdate, { properties : ps, object : obj, index : i });
    }


  }

  // objectExpressionUpdate

  function objectExpressionUpdate(wl,vs) {

    var prop = this.properties[this.index];
    var propName = new Value(null, bot);

    switch (prop.key.type) {
      case 'Identifier' :
        propName.value = prop.key.name;
      break;

      case 'Literal'    :
        // can only be string or number; conversion will occur once assigned to the object
        propName.value = prop.key.value;
      break;
    }

    var propValue = GetValue(vs.pop());
    var propDesc = { enumerable : true, configurable : true };

    switch (prop.kind) {

      case 'init' : 
        propDesc.value    = propValue.value;
        propDesc.label    = propValue.label;
        propDesc.writable = true;
      break;

      case 'get' : 
        propDesc.get   = propValue.value;
        propDesc.label = propValue.label;
      break;

      case 'set' :
        propDesc.set   = propValue.value;
        propDesc.label = propValue.label;
      break;

    }

    var previous = this.object.GetOwnProperty(propName);
   
    monitor.context.pushPC(previous.label);
      if (previous.value !== undefined) {
        if ( (ecma.IsDataDescriptor(previous) && ecma.IsAccessorDescriptor(propDesc)) ||
             (ecma.IsAccessorDescriptor(previous) && ecma.IsDataDescriptor(propDesc)) ||
             (ecma.IsAccessorDescriptor(previous) && ecma.IsAccessorDescriptor(propDesc) &&
              ((previous.get && propDesc.get) || (previous.set && propDesc.set))
             )
           ) {
          monitor.Throw(
            error.SyntaxErrorObject,
            'Object initializer: illegal redefine of property',
            bot
          );
        }
      }
    monitor.context.popPC();
  
    this.object.DefineOwnProperty(propName,propDesc);
  }

  // Function Definition, 13 ----------------------------------------------

  function functionExpression(node,wl,vs) {
    var fun;

    if (node.id) {
      var funcEnv = env.NewDeclarativeEnvironment(monitor.context.lexicalEnv);
      var identifier = new Value(node.id.name,bot);
      funcEnv.CreateImmutableBinding(identifier);

      fun = new _function.FunctionObject(node.params, node.body, new Value(funcEnv, bot));
      fun.Name   = node.id.name;
      fun.Source = node;

      funcEnv.InitializeImmutableBinding(identifier, new Value(fun, bot));
    } else {
      fun = new _function.FunctionObject(node.params, node.body, monitor.context.lexicalEnv);
      fun.Source = node;
    }
    
    vs.push(new Value(fun, bot));
  }
  
  // Comma Operator, 11.14 ------------------------------------------------

  function sequenceExpression(node,wl,vs) {
    var ip  = wl.top();
    var es  = node.expressions;
    var len = es.length;

    for (var i = 0; i < len-1; i++) {
      ip.then(es[i]);
    }

    if (i < len) {
      ip.then(es[i]);
      ip.then(sequenceExpressionEnd, { length : len });
    }
  }

  function sequenceExpressionEnd(wl,vs) {

    var result = vs.pop();

    // Pop all but last and execute GetValue on result for eventual side effects.
    for (var i = 0; i < this.length-1; i++) {
      GetValue(vs.pop());
    }
    vs.push(result);
  }

  // Unary Operators, 11.4 ------------------------------------------------

  function unaryExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.argument);
    ip.then(unarytbl[node.operator]);
  }

  // Binary Operators, 11.5-11.9 -----------------------------------

  function binaryExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.left);
    ip.then(_GetValue);
    ip.then(node.right);
    ip.then(_GetValue);
    ip.then(binarytbl[node.operator]);
  }

  // Prefix, and Postfix Expressions, 11.3, 11.4.4, 11.4.5 -----------------

  function updateExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.argument);
    if (node.prefix) {
      ip.then(prefixtbl[node.operator]);
    } else {
      ip.then(postfixtbl[node.operator]);
    }
  }

  // Binary Operators, 11.5-11.9 -----------------------------------
  
  function logicalExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.left);
    ip.then(logicaltbl[node.operator]);
    ip.then(node.right);
  }

  // Assignment, 11.13 -----------------------------------------------------

  function assignmentExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.left);
    ip.then(node.right);
    ip.then(assignmenttbl[node.operator]);
    ip.then(assignmentExpressionEnd);
  }

  // assignmentExpressionEnd

  function assignmentExpressionEnd(wl,vs) {
    var rval = vs.pop();
    var lref = vs.pop();
    PutValue(lref,rval);
    vs.push(rval);
  }

  // Conditional Operator, 11.12 ------------------------------------------
  
  function conditionalExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.test);
    ip.then(conditionalExpressionChoose, { node : node });

  }

  // conditionalExpressionChoose

  function conditionalExpressionChoose(wl,vs) {
    var ip = wl.top();
    var lval = GetValue(vs.pop());
    var lb   = conversion.ToBoolean(lval);

    var val; 

    monitor.context.pushPC(lb.label);

    if (lb.value) {
      ip.then(this.node.consequent);
    }
    else {
      ip.then(this.node.alternate);
    }

    ip.then(conditionalExpressionEnd, { test : lval }); 
  }

  // conditionalExpressionEnd

  function conditionalExpressionEnd(wl,vs) {
    var val = GetValue(vs.pop());

    monitor.context.popPC();
    vs.push(new Value(val.value, lub(val.label, this.test.label)));
  }
  
  // The new Operator, 11.2.2 ---------------------------------------------
  
  function newExpression(node,wl,vs) {
    var ip = wl.top();
    ip.then(node.callee);
     
    var as  = node.arguments;
    var len = as.length;


    for (var i = 0; i < len; i++) {
      ip.then(as[i]);
    }


    ip.then(newExpressionExecute, { length : len }); 
  }

  // newExpression

  function newExpressionExecute(wl,vs) {
    var c = monitor.context;
    var ip = wl.top();
    
    var argList = [];
    for (var i = this.length-1; i >= 0; i--) {
      argList[i] = GetValue(vs.pop());
    }

    var constructor = GetValue(vs.pop());

    if (typeof constructor.value !== 'object') {
      if (false) { // SILENT ERROR
        v = new Value(undefined, constructor.label);
        return;
      } 
      monitor.Throw(
        error.TypeErrorObject,
        "invalid 'new' parameter",
        constructor.label
      );
    }

    if (! ('Construct' in constructor.value)) {
      if (false) { // SILENT ERROR
        v = new Value(undefined, constructor.label);
        return;
      } 
      monitor.Throw(
        error.TypeErrorObject,
        "invalid 'new' parameter",
        constructor.label
      );
    }

    if (constructor.value.AsyncConstruct) {
      c.pushPC(constructor.label);

      ip = constructor.value.AsyncConstruct(argList);
    
      ip.then(callExpressionEnd, { label : constructor.label });

    } else {
      try {
        var retval = constructor.Construct(argList);
        retval.raise(constructor.label);
        vs.push(retval);
      } catch (e) {

        if (!(e instanceof Value)) {
          throw e;
        }

        var result = c.result;

        // Verfiy that the exception is allowed 
        monitor.assert(le(c.effectivePC, c.labels.exc),
          "exception in " + c.effectivePC + " not allowed with exception label " + c.labels.exc);

        result.type  = 'throw';
        result.value = e; 
      }
    }
  }

  // Function Calls, 11.2.3 -----------------------------------------------
  
  function callExpression(node,wl,vs) {
    var ip = wl.top();

    var as  = node.arguments;
    var len = as.length; 

    ip.then(node.callee);

    for (var i = 0; i < len; i++) {
      ip.then(as[i]);
    }

    ip.then(callExpressionExecute, { length : len, node : node });
  }

  // callExpressionExecute

  function callExpressionExecute(wl,vs) {

    var c = monitor.context;
    var ip = wl.top();

    var argList = []; 
    for (var i = this.length-1; i >= 0; i--) {
      argList[i] = GetValue(vs.pop());
    }

    var ref     = vs.pop();
    var func    = GetValue(ref);

    // used to decide if eval is a direct call in function.enterEvalCode
    c.currentCall = { reference : ref, target : func.value, source : this.node };

    // for eval
    c.call      = {};
    c.call.ref  = ref;
    c.call.func = func;
  
    if (! conversion.IsCallable(func).value) {
      if (false) { // SILENT ERRORS
        v = new Value(undefined,func.label);
        return;
      }
      monitor.Throw(
        error.TypeErrorObject,
        'Invalid call target; ' + pp.pretty(this.node.callee) + ' evaluates to ' + func.value + ' in ' + pp.pretty(this.node),
        func.label
      );
    }

    var thisValue;
    if (ref instanceof Reference) {
      if (ref.IsPropertyReference()) {
        thisValue = ref.base;
      } else {
        thisValue = ref.base.ImplicitThisValue();
      }
    } else {
      thisValue = new Value(undefined, ref.label);
    }

    if (func.value.AsyncCall) {

      monitor.context.pushPC(func.label);

      func.value.AsyncCall(thisValue,argList);
      ip.then(callExpressionEnd, { label : func.label });

    } else {

      try {
        var retval = func.Call(thisValue,argList);
        retval.raise(func.label);
        vs.push(retval);

      } catch (e) {
      
        if (!(e instanceof Value)) {
          throw e;
        }

        var result = c.result;

        // Verfiy that the exception is allowed 
        monitor.assert(le(c.effectivePC, c.labels.exc),
          "exception in " + c.effectivePC + " not allowed with exception label " + c.labels.exc);

        result.type  = 'throw';
        result.value = e; 
      }
    }
  }

  // callExpressionEnd 
  
  function callExpressionEnd(wl,vs) {
    var callResult = vs.pop();
    var c = monitor.context;
    var result = c.result;

    callResult.value.raise(this.label);

    if (callResult.type === 'throw') {
      result.type   = 'throw';
      result.value  = callResult.value;
      return;
    }

    c.popPC();
    vs.push(callResult.value);
  }

  // Property Accessors, 11.2.1 -------------------------------------------

  function memberExpression(node,wl,vs) {
    var ip = wl.top();

    ip.then(node.object);
    ip.then(_GetValue);

    if (node.computed) {
      ip.then(node.property);
      ip.then(_GetValue);
    }

    ip.then(memberExpressionExecute, { node : node });
  }

  function memberExpressionExecute(wl,vs) {

    if (this.node.computed) {
      propertyNameValue = vs.pop();
    } else {
      propertyNameValue = new Value(this.node.property.name, bot);
    }

    var baseValue = vs.pop();

    if (baseValue.value === undefined || baseValue.value === null) {
      monitor.log(pp.pretty(this.node.object) + ' evaluates to ' + String(baseValue.value) + ' in ' + pp.pretty(this.node));
    }

    conversion.CheckObjectCoercible(baseValue);
    vs.push(new Reference(baseValue,conversion.ToString(propertyNameValue)));
  }

  // Identifier, 11.1.2 -> 10.3.1 -----------------------------------------

  function identifierExpression(node,wl,vs) {
    vs.push(env.GetIdentifierReference(monitor.context.lexicalEnv, node.name));
  }

  // Literals, 11.1.3 -> 7.8 ----------------------------------------------
  
  function literalExpression(node,wl,vs) {
    var res = new Value(node.value, bot);

    if (node.value instanceof RegExp) {
      res.value = new RegExpObject(node.value,bot);
    }

    vs.push(res);
  }

  // ------------------------------------------------------------
  // statement handler functions

  var statementtbl = {
    'Program'             : blockStatement,
    'BlockStatement'      : blockStatement,
    'EmptyStatement'      : emptyStatement,
    'ExpressionStatement' : expressionStatement,
    'IfStatement'         : ifStatement,
    'SwitchStatement'     : switchStatement,
    'LabeledStatement'    : labeledStatement,
    'BreakStatement'      : breakStatement,
    'ContinueStatement'   : continueStatement,
    'WithStatement'       : withStatement,
    'ReturnStatement'     : returnStatement,
    'ThrowStatement'      : throwStatement,
    'TryStatement'        : tryStatement,
    'WhileStatement'      : whileStatement,
    'DoWhileStatement'    : doWhileStatement,
    'ForStatement'        : forStatement,
    'ForInStatement'      : forInStatement,

    'VariableDeclaration' : variableDeclaration,
    'FunctionDeclaration' : emptyStatement,
    'DebuggerStatement'   : debuggerStatement
  };

  var emptyLabel = 'default'; // default is a reserved word so no actual label can be named default 

  // ------------------------------------------------------------

  function blockStatement(node,wl) {
    wl.prepend(node.body);
  }

  // ------------------------------------------------------------
  
  function emptyStatement() { 
  }

  // ------------------------------------------------------------
  
  function expressionStatement(node,wl) {
    var ip = wl.top();
    ip.then(node.expression);

    ip.then(expressionStatementEnd);
  }

  function expressionStatementEnd() {
    var c   = monitor.context;
    var vs  = c.valueStack;

    c.result.value = GetValue(vs.pop());
  }

  // ------------------------------------------------------------
  
  function ifStatement(node,wl) {
    var ip = wl.top();

    ip.then(node.test);
    ip.then(ifStatementChoose, { node : node });
  }

  // ifStatementChoose

  function ifStatementChoose(wl,vs) {
    var ip = wl.top();

    var cond = GetValue(vs.pop());
    cond = conversion.ToBoolean(cond);
    
    monitor.context.pushPC(cond.label);

    if (cond.label > monitor.context.pc && hybrid) {
      hybrid(this.node.consequent);
      hybrid(this.node.alternate);
    }

    if (cond.value) {
      ip.then(this.node.consequent);
    } else {
      this.node.alternate && ip.then(this.node.alternate);
    }

    ip.then(ifStatementEnd, { label : cond.label });
  }

  // ifStatementEnd

  function ifStatementEnd(wl,vs) {
    var c = monitor.context;
    c.popPC();
    if (c.result.value) { 
      c.result.value.raise(this.label);
    }
  } 

  ifStatementEnd.runfor =  runfor_continue_break;
  
  // 12.11 ---------------------------------------------------------------------
 
  function switchStatement(node,wl) {
    var c  = monitor.context;    
    var lmap = monitor.context.labels.labelmap;

    if (!node.labelset) {
      node.labelset = new Set([]);
    }
    node.labelset.add(emptyLabel);

    var outerEmptyLabelData = lmap[emptyLabel];
    lmap[emptyLabel] = { label    : c.effectivePC, 
                         pcmarker : c.pcStack.marker() };

    var contextLabel = lmap[emptyLabel].label;
    c.pushPC(contextLabel);

    var switchState = { 
      node                : node, 
      outerEmptyLabelData : label, 
      defaultCaseIndex    : null,
      nextCase            : 0
    };

    if (node.cases) {
      for (var i = 0; i < node.cases.length; i++) {
        if (node.cases[i].test === null) {
          switchState.defaultCaseIndex = i;
          break;
        }
      }
    }

    var ip = wl.top();

    // Store the discriminant value on the value stack.
    // It is later popped by switchStatementEnd.
    ip.then(node.discriminant);
    ip.then(_GetValue);

    // Set up statement labels
    ip.then(switchStatementUpgradeLabels, switchState);

    // Kick off the first case
    ip.then(switchStatementCase, switchState);

    // Clean up and handle breaks
    ip.then(switchStatementEnd, switchState); 
  }

  function switchStatementUpgradeLabels(wl, vs) {
    var c = monitor.context;
    var discriminantLabel = vs.peek().label;
    var lblmap = c.labels.labelmap;
   
    c.labels.pc = lub(c.labels.pc, discriminantLabel);
    
    this.node.labelset.iter(function (name) { 
      lblmap[name].label = lub(lblmap[name].label, discriminantLabel);
    });
  }

  function switchStatementCase(wl, vs) {
    var ip = wl.top();
    var idx = this.nextCase;

    if (this.node.cases === undefined || idx >= this.node.cases.length) {
      // No more cases to try, schedule the default 
      // case if there is one
      if (this.defaultCaseIndex !== null) {
        for (var i = this.defaultCaseIndex; i < this.node.cases.length; i++) {
          for (var j = 0; j < this.node.cases[i].consequent.length; j++) {
            ip.then(this.node.cases[i].consequent[j]);
          }
        }
      }
      return;
    }

    if (idx === this.defaultCaseIndex) {
      // Skip the default case during matching
      this.nextCase += 1;
      ip.then(switchStatementCase, this);
      return;
    }

    vs.dup(); // Duplicate the discriminant value

    // Push the test value
    ip.then(this.node.cases[idx].test);
    ip.then(_GetValue);

    // Test for equality and decide what to do next
    ip.then(switchStatementTest, this);
  }

  function switchStatementTest(wl, vs) {
    var ip = wl.top();

    binaryStrictEqs('===', wl, vs);
    var bresult = vs.pop();

    monitor.context.labels.pc = lub(monitor.context.labels.pc, bresult.label);

    if (bresult.value) {
      // Found a match, schedule all statements from here down
      for (var i = this.nextCase; i < this.node.cases.length; i++) {
        for (var j = 0; j < this.node.cases[i].consequent.length; j++) {
          ip.then(this.node.cases[i].consequent[j]);
        }
      }
    } else {
      this.nextCase += 1;
      ip.then(switchStatementCase, this);
    }
  }

  function switchStatementEnd(wl, vs) {
    var c = monitor.context;

    vs.pop(); // pop the discriminant value
    c.popPC(); // pop the labelContext

    if (c.result.type === 'break' && this.node.labelset.contains(c.result.target)) {
      c.result.type   = 'normal';
      c.result.target = null;
      c.labels.labelmap['empty'] = this.outerEmptyLabelData;
    }
  }
  switchStatementEnd.runfor = runfor_break;

  // 12.12 ---------------------------------------------------------------------

  function labeledStatement(node,wl) {
    var ip = wl.top();
    var c  = monitor.context;

    var pcmarker = c.pcStack.marker();
    var vsmarker = c.valueStack.marker();

    if (!node.body.labelset) { 
      node.body.labelset = new Set([node.label.name]);

      if (node.labelset) {
        node.body.labelset.union(node.labelset);
      }
    }

    var name = node.label.name;
    var outerlabel = setupStatementLabel(name);

    var labeldata = c.labels.labelmap[name];
    labeldata.pcmarker = c.pcStack.marker();
      
    c.pushPC(labeldata.label);

    ip.then(node.body);
    ip.then(labeledStatementEnd,
            { name       : name,
              outerlabel : labeldata.label,
              pcmarker   : pcmarker,
              vsmarker   : vsmarker });
  }

  // labeledStatementEnd
  
  function labeledStatementEnd(wl,vs) {
    var c = monitor.context;

    var result = c.result;

    // reset the outer label - no need to reset pcmarker since
    // statement labels with the same name cannot be nested
    c.labels.labelmap[this.name].label = this.outerlabel;

    c.pcStack.reset(this.pcmarker);
    c.valueStack.reset(this.vsmarker);

    if (result.type === 'break' && result.target === this.name) {
      result = c.result;
      result.type   = 'normal';
      result.target = null;
    }
  }
  
  labeledStatementEnd.runfor = runfor_continue_break; 

  // 12.8 ----------------------------------------------------------------------

  function breakStatement(node,wl) {
    var c = monitor.context;
    var result = monitor.context.result;

    var name       = node.label ? node.label.name : emptyLabel;
    var lblcontext = c.labels.labelmap[name].label;

    var displayName = node.label ? '(' + name + ')' : '';
    monitor.assert(le(c.effectivePC, lblcontext),
      'write context ' + c.effectivePC + ' not below ' +
      'label context ' + lblcontext + ' ' + displayName
    );

    result.type   = 'break';
    result.target = name;
  }

  // 12.7 ----------------------------------------------------------------------

  function continueStatement(node,wl) {
    var c = monitor.context;
    var result = monitor.context.result;

    var name       = node.label ? node.label.name : emptyLabel;
    var lblcontext = c.labels.labelmap[name].label;

    var displayName = node.label ? '(' + name + ')' : '';
    monitor.assert(le(c.effectivePC, lblcontext),
      'write context ' + c.effectivePC + ' not below ' +
      'label context ' + lblcontext + displayName
    );

    result.type   = 'continue';
    result.target = name;
  }

  // 12.10 ---------------------------------------------------------------------

  function withStatement(node,wl) {
    var ip = wl.top();

    ip.then(node.object);
    ip.then(withStatementBody, { node : node });
  }

  // withStatementBody

  function withStatementBody(wl,vs) {
    var ip = wl.top();
    var c = monitor.context;

    var val = GetValue(vs.pop());
    var obj = conversion.ToObject(val);

    var oldEnv = c.lexicalEnv;
    var newEnv = env.NewObjectEnvironment(obj, oldEnv);
    newEnv.provideThis();

    c.lexicalEnv = new Value(newEnv, obj.label);

    ip.then(this.node.body);
    ip.then(withStatementEnd, { lexicalEnv : oldEnv });
  }

  // withStatementEnd

  function withStatementEnd(wl,vs) {
    monitor.context.lexicalEnv = this.lexicalEnv;
  }

  withStatementEnd.runfor = runfor_continue_break;

  //---------------------------------------------------------------------------- 

  function returnStatement(node,wl) {
    var c = monitor.context;
    var ip = wl.top();

    monitor.assert(le(c.effectivePC, c.labels.ret),
      'write context ' + c.effectivePC + ' not below ' +
      'return context ' + c.labels.ret
    );

    if (node.argument) {
      ip.then(node.argument);
    } else {
      c.valueStack.push(new Value(undefined,bot));
    }
    ip.then(returnStatementEnd);
  }

  // returnStatementEnd

  function returnStatementEnd(wl,vs) {
    var result = monitor.context.result;

    result.type   = 'return';
    result.value  = GetValue(vs.pop());
    result.target = null;
  }

  //---------------------------------------------------------------------------- 

  function throwStatement(node,wl) {
    var ip = wl.top();

    ip.then(node.argument);
    ip.then(throwStatementEnd);
  }

  // throwStatementEnd
  function throwStatementEnd(wl,vs) {
    var c = monitor.context;
    var result = c.result;
    var exprRef = vs.pop();

    // Verfiy that the exception is allowed 
    monitor.assert(le(c.effectivePC, c.labels.exc),
      "exception in " + c.effectivePC + " not allowed with exception label " + c.labels.exc);

    result.type  = 'throw';
    result.value = GetValue(exprRef);
    monitor.offendingTrace = monitor.stackTrace();
  }

  //---------------------------------------------------------------------------- 

  function tryStatement(node,wl) {
    var ip = wl.top();
    var c = monitor.context;

    ip.then(node.block);
    // Expression evaluation might cause exceptions; if so the state of
    // the context might need some cleaning up.
    // The result stack and the worklist are not affected by expression so their
    // states are fine.
    // The ret label cannot be affected by exceptions.
    
    // The stacks needs to be reset. 
    var pcmarker = c.pcStack.marker();
    var vsmarker = c.valueStack.marker();
    
    var exc      = c.labels.exc;

    // esprima seems to generate a list of handlers --- standard only supports one
    ip.then(tryStatementCatch,
            { handler : node.handlers[0],
              pcmarker : pcmarker,
              vsmarker : vsmarker,
              exc      : exc });

    // The finalizer 

    var lexicalEnv = c.lexicalEnv;
    ip.then(tryStatementFinally, { body       : node.finalizer, 
                                   pcmarker   : pcmarker,
                                   vsmarker   : vsmarker,
                                   lexicalEnv : lexicalEnv });
        
  }

  // tryStatetementCatch

  function tryStatementCatch(wl,vs) {
    var c = monitor.context;
    var result = c.result;

    // We are in charge of resetting the exc label, the finally does the rest 
    // of the cleaning.

    // The pc of the catch block is pc + exc of body
    var handlerPC = lub(c.labels.pc, c.labels.exc);

    // The exc of the catch block is the exc of _catch, that resets the exc
    c.labels.exc = this.exc;

    // if there is no handler or no exception was thrown, there's nothing more to do
    if (!this.handler || result.type !== 'throw') {
      return;
    }

    c.pcStack.reset(this.pcmarker);
    c.valueStack.reset(this.vsmarker);

    c.pcStack.push(handlerPC);

    var catchEnv = env.NewDeclarativeEnvironment(c.lexicalEnv);
    
    // ECMA-262 allows only idenfifiers, but the parser allows patterns;
    if (this.handler.param.type !== 'Identifier') {
      monitor.fatal('Pattern in catch not supported');
    }

    var identifier = new Value(this.handler.param.name, bot);
    catchEnv.CreateMutableBinding(identifier);
    catchEnv.SetMutableBinding(identifier,result.value);

    c.lexicalEnv = new Value(catchEnv, c.effectivePC);

    result.type  = 'normal';
    result.value = null;

    wl.push(this.handler.body);
  }

  tryStatementCatch.runfor = runfor_throw;

  // tryStatementFinally

  function tryStatementFinally() {
    var c = monitor.context;

    // The pc of the finally is the pc of the try.
    // The exc of the finally is the exc of the _catch, which is either
    // the exc of theee try, unless it was raised by a handler, in which
    // case it escapes the try, and should affect the finally too.

    // We are in charge of resetting the pcStack, and the lexicalEnv 
    c.pcStack.reset(this.pcmarker);
    c.valueStack.reset(this.vsmarker);
    c.lexicalEnv = this.lexicalEnv;
    
    // if there is no finally block, we're done
    if (!this.body) {
      return;
    }

    // Allocate a new result --- _finally env choses between the result
    // of the body/handler, and the result of the finally
    var result = c.result;
    c.result = new Result();

    var ip = c.workList.top();

    ip.then(this.body);
    ip.then(tryStatementFinallyEnd, { result : result });
  }

  tryStatementFinally.runfor = runfor_all;

  // tryStatementFinallyEnd

  function tryStatementFinallyEnd(wl,vs) {
    var c = monitor.context;

    if (c.result.type === 'normal') {
      c.result = this.result;
    }
  }

  tryStatementFinallyEnd.runfor = runfor_all;

  // ------------------------------------------------------------

  function whileStatement(node,wl) {
    var c = monitor.context;
    var ip = wl.top();
    var lmap = c.labels.labelmap;

    if (!node.labelset) {
      node.labelset = new Set([]);
    }
    node.labelset.add(emptyLabel);
    
    var outerEmptyLabelData = lmap[emptyLabel];
    lmap[emptyLabel] = { label    : c.effectivePC, 
                         pcmarker : c.pcStack.marker() };

    var contextLabel = lmap[emptyLabel].label;
    c.pushPC(contextLabel);
    
    ip.then(whileStatementShared, { node : node, outerEmptyLabelData : outerEmptyLabelData });

  }

  // ------------------------------------------------------------

  function doWhileStatement(node,wl) {
    var c = monitor.context;
    var ip = wl.top();
    var lmap = c.labels.labelmap;

    if (!node.labelset) {
      node.labelset = new Set([]);
    }
    node.labelset.add(emptyLabel);

    var outerEmptyLabelData = lmap[emptyLabel];
    lmap[emptyLabel] = { label    : c.effectivePC, 
                         pcmarker : c.pcStack.marker() };

    // used for both statement label security labels and control security label
    var contextLabel = lmap[emptyLabel].label;
    c.pushPC(contextLabel);

    ip.then(node.body);
    ip.then(whileStatementShared, { node : node, outerEmptyLabelData : outerEmptyLabelData });
  }

  // ------------------------------------------------------------
  
  function whileStatementShared(wl,vs) {
    var ip = wl.top();

    var c  = monitor.context;
    var result = c.result;

    if (result.type === 'break' && this.node.labelset.contains(result.target)) {
      result.type   = 'normal';
      result.target = null;
      c.labels.labelmap[emptyLabel] = this.outerEmptyLabelData;
      c.popPC(); // contextLabel
      return;
    }

    if (result.type !== 'continue' || !this.node.labelset.contains(result.target)) {
      if (result.type !== 'normal') {
        return;
      }
    }
    
    // continue gets us here
    result.type   = 'normal';
    result.target = null;

    ip.then(this.node.test);
    ip.then(whileStatementSharedChoose, this);
  }

  whileStatementShared.runfor = runfor_continue_break;

  // whileStatementSharedChoose

  function whileStatementSharedChoose(wl,vs) {
    var c  = monitor.context;

    var cond  = GetValue(vs.pop());
    var condb = conversion.ToBoolean(cond);

    c.labels.pc = lub(c.labels.pc, condb.label);
    if (condb.value) {
      var ip = wl.top();

      ip.then(this.node.body);
      ip.then(whileStatementShared, this);

    } else {
      c.labels.labelmap[emptyLabel] = this.outerEmptyLabelData;
      c.popPC(); // contextLabel
    }
  }

  whileStatementSharedChoose.runfor = runfor_continue;


  // ------------------------------------------------------------

  function forStatement(node,wl) {
    var c = monitor.context;
    var ip = wl.top();
    var lmap = c.labels.labelmap;

    if (node.init) {
      ip.then(node.init);
    }

    if (!node.labelset) {
      node.labelset = new Set([]);
    }
    node.labelset.add(emptyLabel);

    var outerEmptyLabelData = lmap[emptyLabel];
    lmap[emptyLabel] = { label    : c.effectivePC, 
                         pcmarker : c.pcStack.marker() };
    
    var contextLabel = lmap[emptyLabel].label;
    c.pushPC(contextLabel);
        
    ip.then(forStatementMain, { node : node });
    ip.then(forStatementEnd, { outerEmptyLabelData : outerEmptyLabelData });
  }

  // forStatementMain
  function forStatementMain(wl,vs) {
    var c  = monitor.context;
    var ip = wl.top();

    var result = c.result;

    if (result.type === 'break' && this.node.labelset.contains(result.target)) {
      result.type   = 'normal';
      result.target = null;
      return;
    }

    if (result.type !== 'continue' || !this.node.labelset.contains(result.target)) {
      if (result.type !== 'normal') {
        return;
      }
    }

    result.type   = 'normal';
    result.target = null;

    if (this.node.test) {
      ip.then(this.node.test);
      ip.then(forStatementChoose, this);
    } else {
      ip.then(forStatementExecute, this); 
    }
  }
  forStatementMain.runfor = runfor_continue_break;

  // forStatementChoose
  function forStatementChoose(wl,vs) {
    var ip = wl.top();
    var c = monitor.context;
    var result = c.result;

    var cond  = GetValue(vs.pop());
    var condb = conversion.ToBoolean(cond);

    c.labels.pc = lub(c.labels.pc, condb.label);
    if (!condb.value) {
      result.type   = 'normal';
      result.target = null;
      return;
    }
   
    ip.then(forStatementExecute, this);
  }
  forStatementChoose.runfor = runfor_continue;

  function forStatementExecute(wl,vs) {
    var ip = wl.top();

    ip.then(this.node.body);
    ip.then(forStatementUpdate, this);
    ip.then(forStatementMain, this);
    
  }

  function forStatementUpdate(wl,vs) {
    var ip = wl.top();

    var c  = monitor.context;
    var result = c.result;
     
    if (result.type !== 'continue' || !this.node.labelset.contains(result.target)) {
      if (result.type !== 'normal') {
        return;
      }
    }

    result.type   = 'normal';
    result.target = null;

    if (this.node.update) {
      ip.then(this.node.update);
      ip.then(_GetValue);
    }
  }
  forStatementUpdate.runfor = runfor_continue;


  // forStatementeEnd
  function forStatementEnd(wl,vs) {
    var c = monitor.context;
    c.labels.labelmap[emptyLabel] = this.outerEmptyLabelData;
    c.popPC();
  }

  // ------------------------------------------------------------
 
  function forInStatement(node,wl) {
    var ip = wl.top();

    var left;
    if (node.left.type === 'VariableDeclaration') {
      ip.then(node.left);

      // the standard only allows for one declaration, get the name
      left = node.left.declarations[0].id;
    } else {
      left = node.left;
    }
  
    ip.then(node.right);
    ip.then(forInStatementSetup, { node : node, left : left } );
  }  

  function forInStatementSetup(wl,vs) {
    var c = monitor.context;
    var ip = wl.top();
    var lmap = c.labels.labelmap;

    var node = this.node;

    if (!node.labelset) {
      node.labelset = new Set([]);
    }
    node.labelset.add(emptyLabel);

    var outerEmptyLabelData = lmap[emptyLabel];
    lmap[emptyLabel] = { label    : c.effectivePC, 
                         pcmarker : c.pcStack.marker() };

    var contextLabel = lmap[emptyLabel].label;
    c.pushPC(contextLabel);
  
    var obj        = conversion.ToObject(GetValue(vs.pop()));
    var properties = obj.value.getEnumerablePropertyNames(obj.label).reverse();

   // monitor.context.pushPC(obj.label);

    ip.then(forInExecute, { node                : this.node, 
                            left                : this.left, 
                            properties          : properties, 
                            outerEmptyLabelData : outerEmptyLabelData });
  }

  function forInExecute(wl,vs) {
    var ip = wl.top();
    var c  = monitor.context;
    var result = c.result;

    if (result.type === 'break' && this.node.labelset.contains(result.target)) {
      result.type   = 'normal';
      result.target = null;
      c.labels.labelmap[emptyLabel] = this.outerEmptyLabelData;
      c.popPC(); // contextLabel
      return;
    }

    if (result.type !== 'continue' || !this.node.labelset.contains(result.target)) {
      if (result.type !== 'normal') {
        return;
      }
    }

    // continue gets us here
    result.type   = 'normal';
    result.target = null;

    var found = false;
    var propName;
    var P;

    if (this.properties.length === 0) {
      c.labels.labelmap[emptyLabel] = this.outerEmptyLabelMap;
      c.popPC(); // contextLabel
      return;
    }

    propName = this.properties.pop();

    vs.push(propName);
    ip.then(this.left);
    ip.then(forInUpdate, this);
  }
  
  forInExecute.runfor = runfor_continue_break;

  function forInUpdate(wl,vs) {
    var ip = wl.top();

    var lhs = vs.pop();
    var propName = vs.pop();

    PutValue(lhs, propName);

    monitor.context.pushPC(propName.label);

    ip.then(this.node.body);
    ip.then(forInSecurityContextEnd);
    ip.then(forInExecute,this);
  }

  function forInSecurityContextEnd(wl,vs) {
    monitor.context.popPC();
  } 
  
  // ------------------------------------------------------------

  function variableDeclaration(node,wl) {
    var ip = wl.top();

    for (var i = 0, len = node.declarations.length; i < len; i++) {
      var vd = node.declarations[i];
      if (vd.init) {
      
        if (vd.id.type !== 'Identifier') {
          monitor.fatal(vd.id.type + ' not supported in variable declarations');
        }
        
        var lhs = env.GetIdentifierReference(monitor.context.lexicalEnv, vd.id.name);
        ip.then(vd.init);
        ip.then(variableDeclarationUpdate, { lhs : lhs });

      } 
    }
  }

  // variableUpdate
  function variableDeclarationUpdate(wl,vs) {
    var rhs = GetValue(vs.pop());
    PutValue(this.lhs,rhs);
  }

  // ------------------------------------------------------------

  function debuggerStatement(node,wl) {
    monitor.debug.active = true;
  }


  // https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API
  // -------------------------------------------------------------


  function step() {

    var c  = monitor.context;
    var wl = c.workList;
    var vs = c.valueStack;
    
    var result = c.result;

    if (wl.empty()) {
      return false;
    }

    var task = wl.pop();

    try {

      // throw, continue, or break state

      if (result.type !== 'normal') {

        while(true) {

          if (task.runfor && result.type in task.runfor) {
            task(wl,vs);
            return true;
          } 

          if (task.func && task.func.runfor && result.type in task.func.runfor) {
            task.func.call(task.data,wl,vs);
            return true;
          }

          if (wl.empty()) {
            break;
          }
          task = wl.pop();
        }

        return false;
      }

      // function?

      if (typeof task === 'function') {
        task(wl,vs); 
        return true;
      }

      // closure?
      
      if ('func' in task && 'data' in task) {
        task.func.call(task.data,wl,vs);
        return true;
      }


      // otherwise, syntax
      var node = task;
      
      // for stackTrace
      c.currentStatement = node;

      // expressions
      if (node.type in expressiontbl) {
        expressiontbl[node.type](node,wl,vs);
        return true;
      }

      // statement 

      if (node.type in statementtbl) {
        statementtbl[node.type](node,wl);
        return true;
      }

      monitor.fatal(node.type + ' not implemented');

    } catch (e) {
  
      if (e instanceof Value) {

        // Verfiy that the exception is allowed 
        monitor.assert(le(c.effectivePC, c.labels.exc),
          "exception in " + c.effectivePC + " not allowed with exception label " + c.labels.exc);

        result.type  = 'throw';
        result.value = e; 
        return true;
      }

      throw e;
    }
    return true;
  }

  // ----------------------------------------------------------------------------- 
  // Initializes the statement label security label.

  function setupStatementLabel(name) {
    var c = monitor.context;
    var lmap = c.labels.labelmap;
    if (!lmap[name]) {
      lmap[name] = { label : bot, pcmarker : undefined };
    }

    var labeldata = lmap[name];
    var outerlabel = labeldata.label;

    // raise to effective pc
    labeldata.label = lub(labeldata.label, c.effectivePC);

    return outerlabel;
  }


  return module;
};


},{}],31:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function (monitor) {

  var modules = monitor.modules;

  var esprima         = monitor.require('esprima');
  var estraverse      = monitor.require('estraverse');

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var constants       = monitor.require('constants');
  var pp              = monitor.require('pp');


  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------
 
  var module = {};
  module.BuiltinFunctionObject           = BuiltinFunctionObject;
  module.Unimplemented                   = Unimplemented;
  module.FunctionObject                  = FunctionObject;
  module.HasInstance                     = HasInstance;
  module.allocate                        = allocate;
  module.setup                           = setup;
  module.HoistVariables                  = HoistVariables;
  module.HoistFunctions                  = HoistFunctions;
  module.DeclarationBindingInstantiation = DeclarationBindingInstantiation;
  module.enterEvalCode                   = enterEvalCode;

  // ------------------------------------------------------------

  
  function allocate(host) {
    var functionConstructor = new FunctionConstructor(host);
    var functionPrototype   = functionConstructor._proto; 

    return { FunctionConstructor : functionConstructor,
             FunctionPrototype   : functionPrototype
           };
  }

  function setup() {
    monitor.instances.FunctionPrototype.setup();
  }

  // ------------------------------------------------------------

  function BuiltinFunctionObject(f,n,host) {

    Ecma.call(this);
    this.host           = host;
    this.actualFunction = f;

    this.Class          = 'Function';
    // functionPrototype is set before this is run
    this.Prototype      = new Value(monitor.instances.FunctionPrototype,bot);
    this.Extensible     = true;

    var _this           = this;
      
    this.Call           = 
      function(thisArg, args) {
        try {
          return f.call(_this,thisArg, args);
        } catch (e) {

          if (e instanceof Value) {
            throw e;
          }

          monitor.liftException(e,true); 
        }
      };

    this.nativeFunction = f;

    ecma.DefineFFF(this, constants.length, n);
  }

  prelude.inherits(BuiltinFunctionObject,Ecma);

  BuiltinFunctionObject.prototype.Construct = function() {
    monitor.Throw(
      modules.error.TypeErrorObject,
      'cannot be used as a constructor', 
      bot
    );
  };

  BuiltinFunctionObject.prototype.toString = function() {
    if (this.host) {
      return this.host.toString();
    } else {
      return 'NO HOST GIVEN! : ' + this.nativeFunction;
    }
  };

  // ------------------------------------------------------------

  function Unimplemented(name) {

    var f = function() {
      monitor.fatal(name + ' unimplemented in ');
    };

    return f;
  }

  // ------------------------------------------------------------

  function HasInstance(V) {
    var F = this;

    if (typeof V.value !== 'object')
      return new Value(false, V.label);

    var l = V.label;

    var O = F.Get(constants.prototype);
    if (typeof O.value !== 'object') {
      monitor.Throw(
        modules.error.TypeErrorObject,
        'HasInstance',
        bot
      );
    }

    while (V.value !== null) {
      V = V.value.Prototype;
      l = lub(l, V.label);
      if (O.value === V.value) return new Value(true,l);
    }

    return new Value(false,l);
  }

  // ------------------------------------------------------------
  // Function Constructor, 15.3.2 (15.3.1, 15.3.1.1)

  function FunctionConstructor(host) {
    Ecma.call(this);

    // Properties, 15.3.3.
    this.Class      = 'Function';
    this.host       = host;
    this.Extensible = true;

    this._proto     = new FunctionPrototype(this);
    this.Prototype  = new Value(this._proto, bot); 

    // 15.3.3.1 
    ecma.DefineFFF(this,constants.prototype,this._proto);
    // 15.3.3.2 
    ecma.DefineFFF(this, constants.length, 1);
  }

  prelude.inherits(FunctionConstructor, Ecma);

  FunctionConstructor.prototype.HasInstance = HasInstance;

  // 15.3.1
  FunctionConstructor.prototype.Call = function(thisArg, args) {
    return this.Construct(args);
  };

  // 15.3.2
  FunctionConstructor.prototype.Construct = function(args) {
    var argCount = args.length;
    var P = ''; 
    var body;
    var label = bot;

    if (argCount === 0) {
      body = new Value('',bot);
    } else if (argCount === 1) {
      body = args[0];
    } else {
      var firstArg = conversion.ToString(args[0]);
      label = lub(label,firstArg.label);
      P = firstArg.value;

      for (var i = 1; i < argCount - 1; i++) {
        var nextArg = conversion.ToString(args[i]);
        label = lub(label,firstArg.label);
        P += ', ' + nextArg.value;
      }

      body = args[argCount-1];
    }

    body  = conversion.ToString(body);
    label = lub(label,body.label);
    
    P = '(function (' + P + ') { ' + body.value + '});';
    var prog;
    try {
      prog = esprima.parse(P, { loc : true, source : 'Function' } );
    } catch (e) {
      monitor.Throw(
        modules.error.SyntaxErrorObject,
        e.message,
        label
      );
    }
   
    // parsing returns a program --- we are interested in function declaration
    var func = prog.body[0].expression;

    var F = new FunctionObject(
      func.params,
      func.body,
      new Value(monitor.instances.globalEnvironment,bot)
    );

    // For pretty printing
    F.Source = func;

    return new Value(F,label);
  };

  // ------------------------------------------------------------
  // Function Prototype, 15.3.4

  function FunctionPrototype(functionConstructor) {
    Ecma.call(this);
    
    // 15.3.4
    this.Class     = 'Function';
    this.Extensible = true;

    this.host = functionConstructor.host.prototype;

    ecma.DefineFFF(this,constants.length, 0);

    // 15.3.4.1
    ecma.DefineTFT(this,constants.constructor, functionConstructor);

    ecma.DefineTFT(this, constants.toString, new BuiltinFunctionObject(toString, 0, Function.prototype.toString));
    ecma.DefineTFT(this, constants.apply   , new BuiltinFunctionObject(apply   , 2, Function.prototype.apply));
    ecma.DefineTFT(this, constants.call    , new BuiltinFunctionObject(call    , 1, Function.prototype.call));
    ecma.DefineTFT(this, constants.bind    , new BuiltinFunctionObject(bind    , 1, Function.prototype.bind));
  }

  prelude.inherits(FunctionPrototype,Ecma);
  
  FunctionPrototype.prototype.setup = function() {
    this.Prototype  = new Value(monitor.instances.ObjectPrototype, bot); 
  };

  // 15.3.4
  FunctionPrototype.prototype.Call      = function() { return new Value(undefined,bot); };
  FunctionPrototype.prototype.Construct = function() { return new Value(undefined,bot); };

  // ------------------------------------------------------------
  // 15.3.4.2 - Implementation Dependent
  var toString = function(thisArg,args) {
    if (thisArg.value.Source) {
      var str = pp.pretty(thisArg.value.Source);
      return new Value(str,thisArg.label);
    }

    if (thisArg.value.host) {
      var str = thisArg.value.host.toString();
      return new Value(str, thisArg.label);
    }

    return new Value('function', thisArg.label);
  };

  // ------------------------------------------------------------
  // 15.3.4.3
  var apply = function(thisArg,args) {
    var _this    = args[0] ? args[0] : new Value(undefined,bot);
    var argArray = args[1] ? args[1] : new Value(undefined,bot);

    monitor.context.pushPC(thisArg.label);

    if (!conversion.IsCallable(thisArg).value) {
      monitor.Throw(
        modules.error.TypeErrorObject,
        'apply, not a function',
        bot
      );
    }

    monitor.context.raisePC(argArray.label);

    if (argArray.value === null || argArray.value === undefined) {
      var res = thisArg.Call(_this,[]);
      monitor.context.popPC();
      return res;
    }
    
    if (typeof argArray.value !== 'object' || argArray.value.Class === undefined) {
      monitor.Throw(
        modules.error.TypeErrorObject,
        'apply, argument array not an object',
        bot
      );
    }

    var len = argArray.Get(constants.length);
    var n   = conversion.ToUInt32(len);

    var argList = [];
    for (var index = 0; index < n.value; index++) {
      var nextArg = argArray.Get(new Value(index, n.label));
      argList.push(nextArg);
    }

    // Since we cannot transfer the structural or existence info to
    //  the array used by Call, we raise the context accordingly.
    //  This is sound, but potentially an over approximation.

    monitor.context.raisePC(n.label);

    var res = thisArg.Call(_this, argList);

    monitor.context.popPC();
    return res;
  };

  // ------------------------------------------------------------
  // 15.3.4.4
  var call = function(thisArg, args) {

    var _this    = args[0] ? args[0] : new Value(undefined,bot);
    var argList = { };
    
    for (var i = 1; i < args.length; i++) {
      argList[i-1] = args[i];
    }

    argList.length = args.length-1;

    monitor.context.pushPC(thisArg.label);

    if (!conversion.IsCallable(thisArg).value) {
      monitor.Throw(
        modules.error.TypeErrorObject,
        'call, not a function',
        bot
      );
    }

    var res = thisArg.Call(_this, argList);
    monitor.context.popPC();
    return res;
  };

  // ------------------------------------------------------------
  // 15.3.4.5
  var bind = new Unimplemented('bind');

  // ------------------------------------------------------------
  // Function objects, 13.2
    
  function FunctionObject(parms,code,scope) {
    Ecma.call(this);

    this.Class     = 'Function';
    this.Prototype = new Value(monitor.instances.FunctionPrototype,bot);

    this.Scope     = scope;
    this.FormalParameters = parms ? parms : { length : 0 };
    this.Code      = code;

    this.Extensible = true;

    ecma.DefineFFF(this, constants.length, this.FormalParameters.length);
    ecma.DefineTFT(this, constants.arguments, null);

    var proto = new modules.object.ObjectObject();
    ecma.DefineTFT(proto, constants.constructor, this);
    
    ecma.DefineTFT(this, constants.prototype, proto);
  }

  prelude.inherits(FunctionObject, Ecma);

  // ---

  FunctionObject.prototype.AsyncCall = function(thisArg,args) {
    // step 1, as in 10.4.3 embodied in enterFunctionCode
    var funcCtx = enterFunctionCode(this,thisArg,args);
  
    // for stack trace
    funcCtx.owner = this.Name;

    monitor.contextStack.push(funcCtx);
    var ip = funcCtx.workList.top();

      var res;
      if (this.Code) {
        ip.then(this.Code);
        ip.then(AsyncCallEnd);
      } else {
        ip.then(AsyncCallEnd);
      }

  };

  // ---

  function AsyncCallEnd() {
    var callContext = monitor.context;
    monitor.contextStack.pop();
    var callerContext = monitor.context;

    var result = callContext.result;
    var retlabel = callContext.labels.ret;

    if (result.type !== 'normal' && result.value) {
      result.value.raise(retlabel);
    } else {
      result.value = new Value(undefined,retlabel);
    }

    // copy out the inner exception level
    callerContext.labels.exc = lub(callerContext.labels.exc,callContext.labels.exc);
    callerContext.valueStack.push(result);
  }
  AsyncCallEnd.runfor = { 'return' : true, 'throw' : true};

  // ---

  // 13.2.1 
  FunctionObject.prototype.Call = function(thisArg,args){
  
    // step 1, as in 10.4.3 embodied in enterFunctionCode
    var funcCtx = enterFunctionCode(this,thisArg,args);
  
    // for stack trace
    funcCtx.owner = this.Name;

    var res;
    monitor.contextStack.push(funcCtx);

      if (this.Code) {
        res = modules.exec.execute(this.Code, false);
      } 

      if (funcCtx.result.value) {
        funcCtx.result.value.raise(funcCtx.labels.ret);
      }

    monitor.contextStack.pop();

    // copy out the inner exception level
    monitor.context.labels.exc = lub(monitor.context.labels.exc,funcCtx.labels.exc);

    switch (res.type) {
      case 'throw' : 
        throw res.value;
  
      case 'return' : 
        return res.value;
    }

    return new Value(undefined, funcCtx.labels.ret);
  };

  // ---

  FunctionObject.prototype.AsyncConstruct = function(args) {
    var obj = new Ecma();
    obj.Class      = 'Object';
    obj.Extensible = true;

    var proto = this.Get(constants.prototype);
    if (typeof proto.value !== 'object') {
      proto.value = new Value(monitor.instances.ObjectPrototype,bot);
    }

    obj.Prototype = proto;

    var ip = monitor.context.workList.top();

    this.AsyncCall(new Value(obj,bot), args);
    ip.then(AsyncConstructEnd, { object : obj });

    return ip;
  };

  // ---

  function AsyncConstructEnd() {
    var retval = monitor.context.valueStack.peek();
      
    if (typeof retval.value.value !== 'object') {
      retval.value = new Value(this.object, bot); 
    }

  }
  AsyncConstructEnd.runfor = { 'return' : true, 'throw' : true };

  // ---
  // 13.2.2
  FunctionObject.prototype.Construct = function(args) {
    var obj = new Ecma();
    obj.Class      = 'Object';
    obj.Extensible = true;

    var proto = this.Get(constants.prototype);
    if (typeof proto.value !== 'object') {
      proto.value = new Value(monitor.instances.ObjectPrototype,bot);
    }

    obj.Prototype = proto;

    var result = this.Call(new Value(obj,bot), args);

    if (result.value.value !== 'object') {
      result.value = new Value(obj,bot);
    }
    return result;
  };

  // ---

  FunctionObject.prototype.HasInstance = HasInstance;

  // ---

  FunctionObject.prototype.toString = function() {
    if (this.Source) {
        return pp.pretty(this.Source);
    } else if (this.host) {
        return this.host.toString();
    } else {
        return 'host undefined for ' + this.Class;
    }
  };

  // ---

  // TODO: maybe replace with 'waring' getter
  FunctionObject.prototype.toNative = function(deep) {
    monitor.fatal('function/FunctionObject: toNative called on FunctionObject');
  };

  // ------------------------------------------------------------
  // 10.4.3
  function enterFunctionCode(F,thisArg,args) {
    var c = monitor.context;

    if (thisArg.value == null) {
      thisArg = new Value(monitor.instances.globalObject,thisArg.label);
    } else if (typeof thisArg.value !== 'object') {
      thisArg = conversion.ToObject(thisArg);
    }

    var localEnv = new Value(modules.env.NewDeclarativeEnvironment(F.Scope),
                             c.effectivePC);

    var newContext = c.clone(thisArg, localEnv, localEnv);
    newContext.labels.ret = lub(newContext.labels.ret, newContext.labels.pc);
    
    DeclarationBindingInstantiation(newContext,F,args);

    return newContext;
  }

  function enterEvalCode(code, _eval) {
    var c = monitor.context;

    // 15.1.2.1.1, is direct call
    var isDirect;

    isDirect = c.currentCall.reference.base.value instanceof modules.env.ObjectEnvironmentRecord ||
               c.currentCall.reference.base.value instanceof modules.env.DeclarativeEnvironmentRecord;

    isDirect = isDirect && c.currentCall.reference.propertyName.value === 'eval';
    isDirect = isDirect && c.currentCall.target.actualFunction === _eval;
 
    var context = c.clone();

    // 10.4.2 - no calling context or not direct call
    if (!isDirect) {
      var global    = monitor.instances.globalObject;
      var globalEnv = monitor.instances.globalEnvironment;

      context.thisValue   = new Value(global,bot);
      context.lexicalEnv  = new Value(globalEnv,bot);
      context.variableEnv = new Value(globalEnv,bot);
    }

    DeclarationBindingInstantiation(context,code);

    // for stack trace 
    context.owner = 'eval';

    return context;
  }

  // ------------------------------------------------------------
  // 10.5 - strict ignored

  function DeclarationBindingInstantiation(context,F,args) {
    
    var isFunctionCode, isEvalCode, code;
    if (F instanceof FunctionObject) {
      isFunctionCode = true;
      isEvalCode     = false;
      code           = F.Code;
    } else {
      isFunctionCode = false;
      isEvalCode     = true;
      code           = F;
    }

    var env = context.variableEnv;
    var configurableBindings = isEvalCode;
    
    if (isFunctionCode)  {
      BindArguments(env, F.FormalParameters, args);
    }

    var pc = context.effectivePC;

    HoistFunctions(env, code, configurableBindings, pc);

    var argumentsAlreadyDeclared = env.HasBinding(constants['arguments']);

    if (isFunctionCode && !argumentsAlreadyDeclared.value) {
      // make sure it returns a Value
      var argsObj = CreateArgumentsObject(env, F, args);

      F.DefineOwnProperty(constants['arguments'], argsObj,false);

      env.CreateMutableBinding(constants['arguments']);
      env.SetMutableBinding(constants['arguments'], argsObj,false);
    }

    HoistVariables(env, code, configurableBindings, pc);
  }

  // ------------------------------------------------------------
  // Function hoisting, part of 10.5

  function HoistFunctions(env, script, configurableBinding, pc) {

    if (!script.functionDeclarations) {
// 
      script.functionDeclarations = [];

      var visitor = {};
      visitor.leave = function() {};
      visitor.enter = function(node) {
  
        if (node.type === 'FunctionDeclaration') {
          script.functionDeclarations.push(node);
        }

        // Do not hoist inside functions
        if (node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression') {
          this.skip();
        }
      };

      estraverse.traverse(script, visitor);
    }

    var ds = script.functionDeclarations;
    var i;

    var len = ds.length;
    for (i = 0; i < len; i++) {

      var fn = new Value(ds[i].id.name,bot);
      var fo = new FunctionObject(ds[i].params, ds[i].body, env);

      fo.Name   = ds[i].id.name;
      fo.Source = ds[i];

      var funcAlreadyDeclared = env.HasBinding(fn);
      if (!funcAlreadyDeclared.value) {
        env.CreateMutableBinding(fn,configurableBinding);
      }
      
      env.SetMutableBinding(fn, new Value(fo,pc));
    }
  }

  // ------------------------------------------------------------
  // Variable hoisting, part of 10.5

  function HoistVariables(env, script, configurableBindings, pc) {

    if (!script.variableDeclarations) {

      script.variableDeclarations = [];

      var visitor = {};
      visitor.leave = function() {};
      visitor.enter = function(node) {
  
        // Do not hoist inside functions
        if (node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression') {
          this.skip();
        }
  
        if (node.type === 'VariableDeclaration') {
          for (var i = 0, len = node.declarations.length; i < len; i++) {
            var declarator = node.declarations[i];
            var pattern    = declarator.id;
            script.variableDeclarations.push(pattern);
          }
        }
      };

      estraverse.traverse(script, visitor);
    }

    var ds = script.variableDeclarations;
    var i;

    var len = ds.length;
    for (i = 0; i < len; i++) {

      if (ds[i].type !== 'Identifier') {
              monitor.fatal('Patters is variable declarations not supported');
      }
      // declarations are indentifiers, not general patterns
      var dn = new Value(ds[i].name,bot);
    
      var varAlreadyDeclared = env.HasBinding(dn);
      if (!varAlreadyDeclared.value) {
        env.CreateMutableBinding(dn,configurableBindings);
        env.SetMutableBinding(dn,new Value(undefined,pc));
      }
    }
  }

  // ------------------------------------------------------------
  // Create Arguments Object, 10.6

  function CreateArgumentsObject(env, F, args) {
    return new Value(
      new ArgumentsObject(F, args),
      bot
    );
    
    /*
    var obj = new Ecma();
    obj.Class = 'Arguments';

    obj.Prototype = new Value(monitor.instances.ObjectPrototype,bot);

    args = args || []; 

    for (var i = 0, len = args.length; i < len; i++) {
      obj.Put(new Value(i, bot), args[i]);
    }


    var argNames = F.FormalParameters;

    for (var i = 0, len = argNames.length; i < len; i++) {
      var id = argNames[i];

      if (id.type !== 'Identifier') {
        monitor.fatal(id.type + ' is not supported in CreateArgumentsObject');
      } 

      if (args[i]) {
        obj.Put(new Value(id.name, bot), args[i]);
      }
    }

    obj.Put(new Value('length', bot), new Value(args.length, bot));
    obj.Put(new Value('callee', bot), new Value(F, bot));

    return new Value(obj, bot);
    */
  }

  // ------------------------------------------------------------
  // Bind Arguments, 
  function BindArguments(env,names,args) {
    if (args == undefined) return;

    var argCount  = args.length;
    var nameCount = names.length;

    monitor.context.pushPC(bot);
    for (var n = 0; n < nameCount; n++) {
      var v;
      if (n >= argCount)
        v = new Value(undefined,bot);
      else 
        v = args[n];

      var id = names[n];
      if (id.type !== 'Identifier') {
        monitor.fatal(id.type + ' is not supported in BindArguments');
      }

      var argName = new Value(id.name,bot);
      var argAlreadyDeclared = env.HasBinding(argName);

      monitor.context.raisePC(argAlreadyDeclared.label);
      if (!argAlreadyDeclared.value) {
        env.CreateMutableBinding(argName);
      }

      env.SetMutableBinding(argName,v);
    }
    monitor.context.popPC();
  }

  // ------------------------------------------------------------
  function ArgumentsObject(F, args) {
    Ecma.call(this); 
  
    this.Prototype = new Value(monitor.instances.ObjectPrototype, bot);
    this.Class = 'Arguments';
    this.Extensible = true;

    var formalParams = F.FormalParameters;
    var args = args || [];

    for(i = 0; i < args.length; i++) {
      this.Put(new Value(i, bot), args[i]);
    }

    for(i = 0; i < formalParams.length; i++) {
      var id = formalParams[i];

      if(id.type !== 'Identifier') {
        monitor.fatal(id.type + ' is not supported in ArgumentsObject');
      }

      if(args[i]) {
        this.Put(new Value(id.name, bot), args[i]);
      }
    }

    this.Put(new Value('length', bot), new Value(args.length, bot));
    this.Put(new Value('callee', bot), new Value(F, bot));
  }

  prelude.inherits(ArgumentsObject, Ecma);

  ArgumentsObject.prototype.toNative = function() {
    var clone = {},
        lbl = bot;

    for (x in this.properties) {
      if (this.properties.hasOwnProperty(x)) {
        lbl.lub(this.labels[x].existence, this.labels[x].value);

        var v = this.properties[x];
        var t = typeof v;
        if (t !== 'object' || t !== 'function') {
          clone[x] = v;
        } else {
          // TODO: replace with getter
          clone[x] = null;
        }
      }
    }
    
    return new Value(clone, lbl);
  };

  ArgumentsObject.prototype.fromNative = function() {
    // TODO
  };

  return module;
};

},{}],32:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {
  
  var esprima    = monitor.require('esprima');

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');
  var env             = monitor.require('env');
  var error           = monitor.require('error');

  var Value           = monitor.require('values').Value;

  var BiFO            = _function.BuiltinFunctionObject;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.GlobalObject = GlobalObject;
  module.allocate     = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var go = new GlobalObject(host);
    return { globalObject : go };
  }

  // ------------------------------------------------------------

  function GlobalObject(host) {
    ecma.Ecma.call(this);

    this.Class     = 'global';
    this.JSFClass  = 'GlobalObject';
    if (this.Prototype === undefined || this.Prototype.value === null) {
      this.Prototype = new Value(monitor.instances.ObjectPrototype, bot);
    }

    this.host = host;

    // 15.1.1
    ecma.DefineFFF(this, constants.NaN               , NaN);
    ecma.DefineFFF(this, constants['Infinity']       , Infinity);
    ecma.DefineFFF(this, constants['undefined']      , undefined);

    // 15.1.2
    ecma.DefineTFT(this, constants['eval']           , new BiFO(__eval               , 1, host.eval));
    ecma.DefineTFT(this, constants.parseInt          , new BiFO(__parseInt           , 2, host.parseInt));
    ecma.DefineTFT(this, constants.parseFloat        , new BiFO(__parseFloat         , 1, host.parseFloat));
    ecma.DefineTFT(this, constants.isNaN             , new BiFO(__isNaN              , 1, host.isNaN));
    ecma.DefineTFT(this, constants.isFinite          , new BiFO(__isFinite           , 1, host.isFinite));

    // 15.1.3
    ecma.DefineTFT(this, constants.decodeURI         , new BiFO(__decodeURI          , 1, host.decodeURI));
    ecma.DefineTFT(this, constants.decodeURIComponent, new BiFO(__decodeURIComponent , 1, host.decodeURIComponent));
    ecma.DefineTFT(this, constants.encodeURI         , new BiFO(__encodeURI          , 1, host.encodeURI));
    ecma.DefineTFT(this, constants.encodeURIComponent, new BiFO(__encodeURIComponent , 1, host.encodeURIComponent));

    // 15.1.4
    ecma.DefineTFT(this, constants.Object            , monitor.instances.ObjectConstructor);
    ecma.DefineTFT(this, constants.Function          , monitor.instances.FunctionConstructor);
    ecma.DefineTFT(this, constants.Array             , monitor.instances.ArrayConstructor);
    ecma.DefineTFT(this, constants.String            , monitor.instances.StringConstructor);
    ecma.DefineTFT(this, constants.Boolean           , monitor.instances.BooleanConstructor);
    ecma.DefineTFT(this, constants.Number            , monitor.instances.NumberConstructor);
    ecma.DefineTFT(this, constants.Date              , monitor.instances.DateConstructor);
    ecma.DefineTFT(this, constants.RegExp            , monitor.instances.RegExpConstructor);
    ecma.DefineTFT(this, constants.Error             , monitor.instances.ErrorConstructor);
    ecma.DefineTFT(this, constants.EvalError         , monitor.instances.EvalErrorConstructor);
    ecma.DefineTFT(this, constants.RangeError        , monitor.instances.RangeErrorConstructor);
    ecma.DefineTFT(this, constants.ReferenceError    , monitor.instances.ReferenceErrorConstructor);
    ecma.DefineTFT(this, constants.SyntaxError       , monitor.instances.SyntaxErrorConstructor);
    ecma.DefineTFT(this, constants.TypeError         , monitor.instances.TypeErrorConstructor);
    ecma.DefineTFT(this, constants.URIError          , monitor.instances.URIErrorConstructor);
    ecma.DefineTFT(this, constants.Math              , monitor.instances.MathObject);
    ecma.DefineTFT(this, constants.JSON              , monitor.instances.JSONObject);


    ecma.DefineTFT(this, new Value('tt', bot), true, Label.top);
    ecma.DefineTFT(this, new Value('ff', bot), false, Label.top);

    ecma.DefineTFT(this, constants.print , new BiFO(__print , 0, undefined));
    ecma.DefineTFT(this, new Value('lprint',bot) , new BiFO(__lprint , 0, 'lprint'));
    
    if (monitor.instances.LabelConstructor) {
      ecma.DefineTFT(this, new Value('Label',bot), monitor.instances.LabelConstructor);
    }

    if (monitor.instances.ValueConstructor) {
      ecma.DefineTFT(this, new Value('Value',bot), monitor.instances.ValueConstructor);
    }


    ecma.DefineFFF(this , new Value('upg'  , bot), new BiFO(__dupg    , 1, undefined));
    ecma.DefineFFF(this , new Value('upgs' , bot), new BiFO(__dupgs   , 1, undefined));
    ecma.DefineFFF(this , new Value('upge' , bot), new BiFO(__dupge   , 1, undefined));

    ecma.DefineFFF(this , new Value('lbl' , bot), new BiFO(__upg   , 1, undefined));
    ecma.DefineFFF(this , new Value('lbls', bot), new BiFO(__upgs  , 1, undefined));
    ecma.DefineFFF(this , new Value('lble', bot), new BiFO(__upge  , 1, undefined));

    ecma.DefineFFF(this , new Value('upgl' , bot), new BiFO(__upgl   , 1, undefined));

    /*
    ecma.DefineTFT(this, new Value('Label',bot) ,__Label);

    ecma.DefineFFF(this , new Value('declassify'    , bot) , new BiFO(__declassify    , 1, undefined));

    ecma.DefineFFF(this , new Value('upgs'   , bot) , new BiFO(__upgs   , 1, undefined));
    ecma.DefineFFF(this , new Value('dupgs'  , bot) , new BiFO(__dupgs  , 1, undefined));
    ecma.DefineFFF(this , new Value('getPC'  , bot) , new BiFO(__getPC  , 0, undefined));
    ecma.DefineFFF(this , new Value('setPC'  , bot) , new BiFO(__setPC  , 1, undefined));
    ecma.DefineFFF(this , new Value('getEXC' , bot) , new BiFO(__getEXC , 0, undefined));
    ecma.DefineFFF(this , new Value('setEXC' , bot) , new BiFO(__setEXC , 1, undefined));
    ecma.DefineFFF(this , new Value('getRET' , bot) , new BiFO(__getRET , 0, undefined));
    ecma.DefineFFF(this , new Value('setRET' , bot) , new BiFO(__setRET , 1, undefined));
    */
    
    ecma.DefineTFT(this , new Value('unescape' , bot) , new BiFO(__unescape , 1, host.unescape));
}

  prelude.inherits(GlobalObject,ecma.Ecma);

  /*
  GlobalObject.extensions = [];
  GlobalObject.addExtension = function(ext) {
    GlobalObject.extensions.push(ext);
  };
  */

  GlobalObject.prototype.toString = function() { return '[global object]'; };

  // ------------------------------------------------------------
  // unescape, B2.2
  var __unescape = function(thisArg, args) {
    var str = args[0] ? args[0] : new Value(undefined,bot);
    str = conversion.ToString(str);

    return new Value(unescape(str.value), str.label);
  };
  // ------------------------------------------------------------
  // 15.1.2.1
  var __eval = function(thisArg, args) {
    var arg0 = args[0];
    if (arg0 === undefined) return new Value(undefined,bot);
    if (typeof arg0.value !== 'string') return arg0;

    var prog;

    // raise the pc w.r.t. the program string; parsing may result in an exception
    monitor.context.pushPC(arg0.label);

      try {
        prog = esprima.parse(arg0.value, { loc : true, source : 'eval' });
      } catch(e) {
        var msg = e.description + ' in eval:' + e.lineNumber + ':' + e.column;
        monitor.Throw(
          error.SyntaxErrorObject,
          msg,
          arg0.label
        );
      }

      var evalCtx = _function.enterEvalCode(prog, __eval);
      monitor.contextStack.push(evalCtx);

        // this is not a value, it is a result!!
        var result = monitor.modules.exec.execute(prog,false);


        // if value is 'empty' (represented by null)
        if (!result.value) {
          result.value = new Value(undefined,bot);
        }

        result.value.raise(arg0.label);

        // NOTE: parser should guarantee the result type is never return

        if (result.type === 'throw') {
          throw result.value;
        }

      // pop after throw, otherwise internal context thrown away before handler (catch)
      monitor.contextStack.pop();

    monitor.context.popPC();

    return result.value;
  };

  // ------------------------------------------------------------
  // 15.1.2.2
  var __parseInt = function(thisArg, args) {
    var string = args[0] || new Value(undefined,bot);
    var radix  = args[1] || new Value(undefined,bot);

    string = conversion.ToString(string);
    var value = parseInt(string.value, radix.value);
    return new Value(value, lub(string.label, radix.label));
  };

  // ------------------------------------------------------------
  // 15.1.2.3
  var __parseFloat = function(thisArg, args) {
    var string = args[0] || new Value(undefined, bot);
    string = conversion.ToString(string);
    var value = parseFloat(string.value);
    return new Value(value, string.label);
  };

  // ------------------------------------------------------------
  // 15.1.2.4
  var __isNaN = function(thisArg,args) {
    var number = args[0] || new Value(undefined,bot);
    number = conversion.ToNumber(number);
    var value = isNaN(number.value);
    return new Value(value, number.label);
  };

  // ------------------------------------------------------------
  // 15.1.2.5
  var __isFinite = function(thisArg,args) {
    var number = args[0] || new Value(undefined,bot);
    number = conversion.ToNumber(number);
    var value = isFinite(number.value);
    return new Value(value, number.label);
  };

  // ------------------------------------------------------------
  // 15.1.3.1
  var __decodeURI = function (thisArg, args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);
    var enc  = conversion.ToString(arg0);
    var res  = new Value(decodeURI(enc.value), enc.label);
    return res;
  };

  // ------------------------------------------------------------
  // 15.1.3.2
  var __decodeURIComponent = function(thisArg,args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);
    var enc  = conversion.ToString(arg0);
    var res  = new Value(decodeURIComponent(enc.value), enc.label);
    return res;
  };
  
  // ------------------------------------------------------------
  // 15.1.2.3
  var __encodeURI = function (thisArg, args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);
    var enc  = conversion.ToString(arg0);
    var res  = new Value(encodeURI(enc.value), enc.label);
    return res;
  };

  // ------------------------------------------------------------
  // 15.1.3.4
  var __encodeURIComponent = function(thisArg, args) {
    var arg0 = args[0] !== undefined? args[0] : new Value(undefined,bot);
    var componentString = conversion.ToString(arg0);
    return new Value(encodeURIComponent(componentString.value), componentString.label);
  };

  // ------------------------------------------------------------

  var __print = function(thisArg,args) {
    var str = '';
    for (var i = 0; i < args.length; i++)
      str += args[i].value;
    monitor.print(str);

    return new Value(undefined,bot);
  };

  var __lprint = function(thisArg,args) {
    var str = '';
    for (var i = 0; i < args.length; i++)
      str += args[i];
    monitor.print('(' + monitor.context.effectivePC + '):' + str);

    return new Value(undefined,bot);
  };

  // ------------------------------------------------------------

  var __alert = function(thisArg,args) {
    var str = 'alert: ';
    for (var i = 0; i < args.length; i++)
      str += args[i].value;
    monitor.print(str);

    return new Value(undefined,bot);
  };

  // ------------------------------------------------------------

  var __upgl = function(thisArg,args) {
    var labelName     = args[0] ? args[0] : new Value('default', bot);
    
    monitor.assert(le(labelName.label, bot));

    var lbl = bot;
    for (var i = 1; i < args.length; i++) {
      monitor.assert(le(args[i].label, bot));
      lbl = lub(lbl, Label.fromString(args[i].value));
    }

    lbl = lbl.equals(bot) ? Label.top : lbl;
    
    var lblmap = monitor.context.labels.labelmap;
    var name = labelName.value;
    if (!lblmap[name]) {
      lblmap[name] = {
        label    : lbl,
        pcmarker : undefined
      };
    }

    lblmap[name].label = lub(lblmap[name].label, lbl);
    if (lblmap[name].pcmarker) {
      monitor.context.pcStack.map(
        function(l) {
          return lub(l,lbl);
        },
        lblmap[name].pcmarker
      );
    }

    return new Value(undefined,bot);
  };

  // ------------------------------------------------------------

  var __upg = function(thisArg,args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);

    var lbl = bot;
    for (var i = 1; i < args.length; i++) {
      monitor.assert(le(args[i].label, bot));
      lbl = lub(lbl, Label.fromString(args[i].value));
    }

    lbl = lbl.equals(bot) ? Label.top : lbl;
    
    return new Value(arg0.value, lub(arg0.label, lbl));
  };

  // ------------------------------------------------------------

  var __dupg = function(thisArg,args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);

    var lbl = bot;
    for (var i = 1; i < args.length; i++) {
      lbl = lub(lbl, args[i].label);
    }
    
    return new Value(arg0.value, lub(arg0.label, lbl));
  };

  // ------------------------------------------------------------

  var __upgs = function(thisArg,args) {
    var obj = args[0] ? args[0] : new Value(undefined, bot);

    var lbl = bot;
    for (var i = 1; i < args.length; i++) {
      monitor.assert(le(args[i].label, bot));
      lbl = lub(lbl, Label.fromString(args[i].value));
    }


    lbl = lbl.equals(bot) ? Label.top : lbl;

    if (obj.value != undefined && obj.value.struct !== undefined) {
      obj.value.struct = lub(obj.value.struct, lbl);
    }

    return obj;
  };

  // ------------------------------------------------------------

  var __dupgs = function(thisArg,args) {
    var arg0 = args[0] ? args[0] : new Value(undefined, bot);

    var lbl = bot;
    for (var i = 1; i < args.length; i++)  {
      lbl = lub(lbl, args[i].label);
    }
    
    if (arg0.value != undefined && arg0.value.struct !== undefined) {
      arg0.value.struct = lub(arg0.value.struct, lbl);
    }
      
    return arg0;
  };

  // ------------------------------------------------------------

  var __upge = function(thisArg,args) {
    var obj = args[0] ? args[0] : new Value(undefined, bot);
    var ix  = args[1] ? args[1] : new Value(undefined, bot);

    if (obj.value === undefined || obj.value === null) {
      return new Value(undefined, bot);
    }

    ix = conversion.ToString(ix);
      
    var lbl = bot;
    for (var i = 2; i < args.length; i++) {
      monitor.assert(le(args[i].label, bot));
      lbl = lub(lbl, Label.fromString(args[i].value));
    }

    lbl = lbl.equals(bot) ? Label.top : lbl;
    

    var prop = obj.value.map.get(ix.value);
    if (prop) {
      prop.existence = lub(prop.existence, lbl);
    }

    return new Value(undefined,bot);
  };

  // ------------------------------------------------------------

  var __dupge = function(thisArg,args) {
    var obj = args[0] ? args[0] : new Value(undefined, bot);
    var ix  = args[1] ? args[1] : new Value(undefined, bot);

    if (obj.value === undefined || obj.value === null) {
      return new Value(undefined, bot);
    }

    ix = conversion.ToString(ix);

    var lbl = bot;
    for (var i = 1; i < args.length; i++)  {
      lbl = lub(lbl, args[i].label);
    }

    
    var prop = obj.value.map.get(ix.value);
    if (prop) {
      prop.existence = lub(prop.existence, lbl);
    }

    return new Value(undefined,bot);
  };

  
  // ------------------------------------------------------------

  var __declassify = function(thisArg,args) {

    var val = new Value( args[0] ? args[0].value : undefined, bot);
    return val;

  };

  // ------------------------------------------------------------

  return module;
};

},{}],33:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var prelude    = monitor.require('prelude');
  var label      = monitor.require('label');
  var conversion = monitor.require('conversion');
  var constants  = monitor.require('constants');
  var ecma       = monitor.require('ecma');
  var _function  = monitor.require('function');

  var object     = monitor.require('object');
  var array      = monitor.require('array');
  var number     = monitor.require('number');
  var string     = monitor.require('string');
  
  var BiFO       = _function.BuiltinFunctionObject;
  var Value      = monitor.require('values').Value;

  var Label      = label.Label;
  var lub        = label.lub;
  var glb        = label.glb;
  var le         = label.le;

  var bot        = Label.bot;

  // ------------------------------------------------------------
  
  var module = {};
  module.allocate   = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var jsonObject = new JSONObject(host.JSON);
    return { JSONObject : jsonObject };
  }

  // ------------------------------------------------------------
  // The JSON object, 15.12
  function JSONObject(host) {
    ecma.Ecma.call(this);
    
    this.Prototype  = new Value(monitor.instances.ObjectPrototype, bot);
    this.Class      = 'JSON';
    this.Extensible = true; 
    this.host       = host;

    ecma.DefineFFF(this, constants.prototype, monitor.instances.ObjectPrototype);
 
    ecma.DefineTFT(this , constants.parse     , new BiFO(parse     , 2 , this.host.parse));
    ecma.DefineTFT(this , constants.stringify , new BiFO(stringify , 3 , this.host.stringify));
  }

  prelude.inherits(JSONObject, ecma.Ecma);

  // By the standard, there should be no Call or Construct for JSON object,
  // so throw a TypeError (as SpiderMonkey seem to do)
  JSONObject.prototype.Call = function() {
    monitor.Throw(
      monitor.modules.error.TypeErrorObject,
      'JSON is not a function',
      bot
    );
  };

  JSONObject.prototype.Construct = function() {
    monitor.Throw(
      monitor.modules.error.TypeErrorObject,
      'JSON is not a constructor',
      bot
    );
  }

  // ------------------------------------------------------------
  // parse, 15.12.2
  var parse = function(thisArg, args) {
    if(args[0] === undefined) {
      monitor.Throw(
        monitor.modules.error.SyntaxErrorObject,
        'JSON.parse: No string to parse',
        bot
      );
    }

    var JText = conversion.ToString(args[0]) || new Value(undefined, bot);
    var reviver = args[1] || new Value(undefined, bot);

    var unfiltered = parseAndEvaluate(JText);

    // Do we have any junk characters left? If so, a bad string!
    if(unfiltered.finalIndex <= JText.value.length) {
      monitor.Throw(
        monitor.modules.error.SyntaxErrorObject,
        'JSON.parse: String contains bad symbols in the end',
        bot
      );
    }
    
    var isReviverCallable = conversion.IsCallable(reviver);

    monitor.context.pushPC(isReviverCallable.label);
    if(isReviverCallable.value) {
      var root = new object.ObjectObject();

      root.DefineOwnProperty(new Value("", bot), 
                             { value        : unfiltered,
                               writable     : true,
                               enumerable   : true,
                               configurable : true,
                               label        : unfiltered.label
                             },
                             false
                            );

      monitor.context.popPC();
      return Walk(root, new Value("", lub(unfiltered.label, lub(JText.label, reviver.label))), reviver);
    }
    else {
      monitor.context.popPC();
      return unfiltered;
    }
  };

  // Walk, part of 15.12.2
  var Walk = function(holder, name, reviver) {
    var val = holder.Get(name);

    monitor.context.pushPC(val.label);
    if(val.value && typeof val.value === 'object') {
      val = val.value;
      monitor.context.pushPC(val.label);
      if(val.value.Class === 'Array') {
        var I = new Value(0, bot);
        var len = val.value.Get(constants.length);

        while(I.value < len.value) {
          var newElement = Walk(val, conversion.ToString(I), reviver);
          if(newElement === undefined) {
            val.Delete(conversion.ToString(I), false);
          }
          else {
            val.DefineOwnProperty(conversion.ToString(I),
                                  { value : newElement.value,
                                    writable : true,
                                    enumerable : true,
                                    configurable : true,
                                    label : val.label
                                  },
                                  false
                                 );
          }

          I.value++;
        }
      }
      else {
        var keys = [];
        var allKeys = Object.keys(val.value.properties);

        for(var i = 0; i < allKeys.length; i++) {
          var keyVal = val.GetProperty(new Value(allKeys[i], bot));

          if(keyVal.value && keyVal.value.enumerable) {
            keys.push(new Value(allKeys[i], bot)); //keyVal.label?
          }
        }

        for(var i = 0; i < keys.length; i++) {
          var P = conversion.ToString(keys[i]);
          var newElement = Walk(val, P, reviver);
          
          if(newElement === undefined) {
            val.Delete(P, false);
          }
          else {
            val.DefineOwnProperty(P,
                                  { value : newElement.value,
                                    writable : true,
                                    enumerable : true,
                                    configurable : true,
                                    label : val.label
                                  },
                                  false
                                 );
          }
        }
      }
      monitor.context.popPC();
    }

    monitor.context.popPC();
    return reviver.Call(holder, [name, val]);
  };

  // Inspiration from Douglas Crockford, https://github.com/douglascrockford/JSON-js/blob/master/json_parse.js
  // This is used for the 2nd and 3rd step in parse, 15.12.2
  var parseAndEvaluate = function(text) {
    var currentChar = ' ';
    var currentIndex = 0;

    // From 15.12.1.1, JSONEscapeCharacter :: one of " / \ b f n r t
    var escapeCharacters = {
      '"': '"',
      '/': '/',
      '\\': '\\',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t'
    };

    // These are not allowed to have in a string!
    var invalidStringCharacters = {};
    for(var i = 0x00; i <= 0x1F; i++) {
      var s = String.fromCharCode(i);
      invalidStringCharacters[s] = s;
    }

    var mkError = function(message) {
      monitor.Throw(
        monitor.modules.error.SyntaxErrorObject,
        'JSON.parse: ' + message,
        bot
      );
    };

    var nextChar = function(char) {
      if(char && char !== currentChar) {
        mkError('expected ' + char + ' to match ' + currentChar);
      }

      currentChar = text.charAt(currentIndex);
      currentIndex++;

      return currentChar;
    };

    //JSONWhiteSpace :: <TAB> <CR> <LF> <SP>
    var eatWhiteSpace = function() {
      while(currentChar && currentChar <= ' ') {
        nextChar();
      }
    };

    /* JSONValue :
         JSONNullLiteral
         JSONBooleanLiteral
         JSONObject
         JSONArray
         JSONString
         JSONNumber
    */
    var jsonValue = function() {
      eatWhiteSpace();
      switch(currentChar) {
      case '{':
        // It must be an object
        return jsonObject();

      case '[':
        // It must be an array
        return jsonArray();

      case '"':
        // It must be a string
        return jsonString();

      case '-':
        // It must be a number
        return jsonNumber();

      case 'n':
        // It must be a null literal
        return jsonNull();

      case 't':
      case 'f':
        // It must be a boolean literal
        return jsonBool();

      default:
        if(currentChar >= '0' && currentChar <= '9') {
          // It must be a number
          return jsonNumber();
        }

        // Otherwise, something has gone wrong!
        mkError('Cannot parse the structure!');
      }
    };

    var jsonObject = function() {
      var result = new object.ObjectObject();

      if(currentChar === '{') {
        nextChar('{');
        eatWhiteSpace();

        if(currentChar === '}') {
          // Enter here and we have an "empty" object
          nextChar('}');
          return result;
        }

        while(currentChar) {
          var key = jsonString();
          eatWhiteSpace();
          nextChar(':');

          if(result.hasOwnProperty(key)) {
            mkError('Bad object, duplicate key ' + key);
          }

          result.DefineOwnProperty(new Value(key, bot), 
                                   { value        : jsonValue(),
                                     writable     : true,
                                     enumerable   : true,
                                     configurable : true,
                                     label        : bot
                                   },
                                   false
                                  );

          eatWhiteSpace();
          if(currentChar === '}') {
            nextChar('}');
            return result;
          }

          nextChar(',');
          eatWhiteSpace();
        }
      }

      mkError('Malformed object');
    };

    var jsonArray = function() {
      var result = [];

      if(currentChar === '[') {
        nextChar('[');
        eatWhiteSpace();

        if(currentChar === ']') {
          // Enter here and we have an empty array..
          nextChar(']');
          return array.ArrayObject.fromValueArray(result);
        }

        while(currentChar) {
          result.push(jsonValue());
          eatWhiteSpace();

          if(currentChar === ']') {
            // Enter here and we are done..
            nextChar(']');
            for(var i = 0; i < result.length; i++) {
              result[i] = new Value(result[i], bot);
            }

            return array.ArrayObject.fromValueArray(result);
          }

          nextChar(','); // If we are not done, we expect a ','
          eatWhiteSpace();
        }
      }

      mkError('Could not parse the array');
    };

    /*
      JSONString :: " JSONStringCharacters_opt "
      JSONStringCharacters :: JSONStringCharacter JSONStringCharacters_opt
      JSONStringCharacter :: SourceCharacter but not one of " or \ or U+0000 through U+001F \ JSONEscapeSequence
      JSONEscapeSequence :: JSONEscapeCharacter UnicodeEscapeSequence
     */
    var jsonString = function() {
      var result = "";

      if(currentChar === '"') {
        while(nextChar()) {
          if(currentChar === '"') {
            nextChar();
            return result;
          }

          // Check if the current character is an invalid string
          if(invalidStringCharacters[currentChar]) {
            mkError("Invalid character in string");
          }

          if(currentChar === '\\') {
            nextChar();

            if(currentChar === 'u') {
              var hexValue = 0;
              for(var i = 0; i < 4; i++) {
                var hex = parseInt(nextChar(), 16);
                if(!isFinite(hex)) {
                  break;
                }

                hexValue = hexValue * 16 + hex;
              }

              result += String.fromCharCode(hexValue);
            }
            else if(typeof escapeCharacters[currentChar] === 'string') {
              result += escapeCharacters[currentChar];
            }
            else {
              break;
            }
          }
          else {
            result += currentChar;
          }
        }
      }

      mkError('Bad input string');
    };

    // JSONNumber :: -_opt DecimalIntegerLiteral JSONFraction_opt ExponentPart_opt
    var jsonNumber = function() {
      var result = "", checkOctal = false, checkFloat = false;

      if(currentChar === '-') {
        result += currentChar;
        nextChar('-');
      }

      if(currentChar === '0') {
        checkOctal = true;
      }

      // Get all the numbers
      while(currentChar >= '0' && currentChar <= '9') {
        result += currentChar;
        nextChar();
      }

      if(checkOctal && result.length > 1) {
        mkError("JSON.parse: Numbers cannot start with a 0");
      }

      // Check if it is a float
      if(currentChar === '.') {
        result += currentChar;
        checkFloat = true;

        // Get all the remaining numbers in the float
        while(nextChar() && currentChar >= '0' && currentChar <= '9') {
          result += currentChar;
          checkFloat = false;
        }
      }

      if(checkFloat) {
        mkError("JSON.parse: Number with nothing after the decimal");
      }
      
      if(currentChar === 'e' || currentChar === 'E') {
        result += currentChar;
        nextChar();
        if(currentChar === '-' || currentChar === '+') {
          result += currentChar;
          nextChar();
        }
        while(currentChar >= '0' && currentChar <= '9') {
          result += currentChar;
          nextChar();
        }
      }

      var num = +result; // Nasty conversion. :)
      if(!isFinite(num)) {
        mkError('Bad number, not finite');
      }

      return num;
    };

    // JSONNullLiteral :: NullLiteral
    var jsonNull = function() {
      nextChar('n');
      nextChar('u');
      nextChar('l');
      nextChar('l');
      return null;
    };

    // JSONBooleanLiteral :: BooleanLiteral
    var jsonBool = function() {
      switch(currentChar) {
        case 't':
        nextChar('t');
        nextChar('r');
        nextChar('u');
        nextChar('e');
        return true;

      case 'f':
        nextChar('f');
        nextChar('a');
        nextChar('l');
        nextChar('s');
        nextChar('e');
        return false;

      default:
        mkError('Could not deduce a boolean');
      }
    };

    if(text.value) {
      var textLabel = text.label;
      text = text.value;
      var res = new Value(jsonValue(), textLabel);
      eatWhiteSpace();  // Eat all trailing white spaces
      res.finalIndex = currentIndex;  // This is needed to know if we have some garbage at the end of the string
      return res;
    }
    else {
      mkError('Bad format on input');
    }
  };


  // ------------------------------------------------------------
  // stringify, 15.12.3
  var stringify = function(thisArg, args) {
    // These are used for cycle detection
    var JA_counter = 0;
    var JO_counter = 0;
    //-------------------------------------------

    var stack = [];
    var indent = "";
    var PropertyList, ReplacerFunction;
    var gap = "";

    var value = args[0] || new Value(undefined, bot);
    var replacer = args[1] || new Value(undefined, bot);
    var space = args[2] || new Value(undefined, bot);

    var retLabel = lub(value.label, lub(replacer.label, space.label));

    monitor.context.pushPC(replacer.label);
    if(typeof replacer.value === 'object' || typeof replacer.value === 'function') {
      if(conversion.IsCallable(replacer).value) {
        ReplacerFunction = replacer;
      }
      else if(replacer.value && replacer.value.Class === 'Array') {
        PropertyList = [];

        var initialReplacerLength = replacer.value.properties.length;
        for(var i = 0; i < initialReplacerLength; i++) {
          var item = undefined;
          var v = replacer.Get(new Value(i, bot));

          if(v.value !== undefined) {
            if(typeof v.value === 'string') {
              item = v;
            }
            else if(typeof v.value === 'number') {
              item = conversion.ToString(v);
            }
            else if(typeof v.value === 'object') {
              if(v.value && (v.value.Class === 'String' || v.value.Class === 'Number')) {
                item = conversion.ToString(v);
              }
            }

            
            if(item !== undefined) {
              var itemNotInArray = true;
              for(var j = 0; j < PropertyList.length; j++) {
                if(item.value === PropertyList[j].value) {
                  itemNotInArray = false;
                  break;
                }
              }

              if(itemNotInArray) {
                PropertyList.push(item);
              }
            }
          }
        }
      }
    }
    monitor.context.popPC();

    monitor.context.pushPC(space.label);
    if(typeof space.value === 'object') {
      if(space.value.Class === 'Number') {
        space = conversion.ToNumber(space);
      }
      else if(space.value.Class === 'String') {
        space = conversion.ToString(space);
      }
    }

    if(typeof space.value === 'number') {
      var intSpace = conversion.ToInteger(space);
      if(intSpace.value > 10) {
        space = new Value(10, space.label);
      }
      else {
        space = intSpace;
      }

      for(var i = 0; i < space.value; i++) {
        gap = gap + " ";
      }
    }
    else if(typeof space.value === 'string') {
      if(space.value.length <= 10) {
        gap = space.value;
      }
      else {
        gap = space.value.substring(0, 10);
      }
    }
    // Leave the last else, gap will be empty string if none of the above has been hit
    monitor.context.popPC();  // Pop space.label from the PC stack

    var wrapper = new object.ObjectObject();
    wrapper.DefineOwnProperty(new Value("", bot), 
                              { value        : value.value,
                                writable     : true,
                                enumerable   : true,
                                configurable : true,
                                label        : value.label
                              },
                              false
                             );

    var Str = function(key, holder) {
      var value = holder.Get(key);

      retLabel = lub(retLabel, value.label);

      monitor.context.pushPC(value.label);
      if(value.value && typeof value.value === 'object') {
        var toJSON = value.Get(new Value("toJSON", bot));

        if(conversion.IsCallable(toJSON).value) {
          value = toJSON.Call(value, [key]);
        }
      }
      monitor.context.popPC();  // As it is being pushed again later, is this needed?

      if(ReplacerFunction) {
        monitor.context.pushPC(ReplacerFunction.label);
        if(ReplacerFunction.value) {
          value = ReplacerFunction.Call(holder, [key, value]);
        }
        monitor.context.popPC();
      }

      monitor.context.pushPC(value.label);
      if(value.value && typeof value.value === 'object') {
        if(value.value.Class === 'Number') {
          value = conversion.ToNumber(value);
        }
        else if(value.value.Class === 'String') {
          value = conversion.ToString(value);
        }
        else if(value.value.Class === 'Boolean') {
          value = new Value(value.value.PrimitiveValue.valueOf(), retLabel);
        }
      }

      if(value.value === null) {
        monitor.context.popPC();
        return new Value("null", retLabel);
      }
      if(value.value === true) {
        monitor.context.popPC();
        return new Value("true", retLabel);
      }
      if(value.value === false) {
        monitor.context.popPC();
        return new Value("false", retLabel);
      }

      if(typeof value.value === 'string') {
        var res = Quote(value);
        monitor.context.popPC();
        return res;
      }

      if(typeof value.value === 'number') {
        if(isFinite(value.value)) {
          var res = conversion.ToString(value);
          monitor.context.popPC();
          return res;
        }

        monitor.context.popPC();
        return new Value("null", retLabel);
      }

      if(typeof value.value === 'object' && !conversion.IsCallable(value).value) {
        if(value.value.Class === 'Array') {
          var res = JA(value);
          monitor.context.popPC();
          return res;
        }

        var res = JO(value);
        monitor.context.popPC();
        return res;
      }

      monitor.context.popPC();
      return new Value(undefined, retLabel);
    };

    var Quote = function(value) {
      var product = "\"";
      for(var i = 0; i < value.value.length; i++) {
        var C = value.value[i];
        var cCodePointValue = C.codePointAt(0);
        var spaceCodePointValue = (" ").codePointAt(0);
        
        if(C === "\"" || C === "\\") {
          product += "\\";
          product += C;
        }
        else if(C === "\b" || C === "\f" || C === "\n" || C === "\r" || C === "\t") {
          product += "\\";
          var abbrev;
          if(C === "\b") abbrev = "b";
          else if(C === "\f") abbrev = "f";
          else if(C === "\n") abbrev = "n";
          else if(C === "\r") abbrev = "r";
          else abbrev = "t";

          product += abbrev;
        }
        else if(cCodePointValue < spaceCodePointValue) {
          product += "\\";
          product += "u";
          var hex = cCodePointValue.toString(16);
          for(var j = hex.length; j < 4; j++) {
            hex = "0" + hex;
          }

          product += hex;
        }
        else {
          product += C;
        }
      }

      product += "\"";
      return new Value(product, lub(monitor.context.effectivePC, value.label));
    };

    var JO = function(value) {
      var JO_key = new Value("JO_property", bot);
      if(!value.Get(JO_key).value) {
        JO_counter++;
        value.DefineOwnProperty(JO_key,
                                { value        : new Value(JO_counter, bot),
                                  writable     : false,
                                  enumerable   : false,
                                  configurable : false,
                                  label        : bot
                                },
                                false);
      }
      else {
        checkCycle(JO_key, value);
      }

      stack.push(value);
      var stepback = indent;
      indent = indent + gap;

      if(PropertyList !== undefined) {
        var K = PropertyList;
      }
      else {
        var K = [];
        var allKeys = Object.keys(value.value.properties);

        for(var i = 0; i < allKeys.length; i++) {
          var keyVal = value.GetProperty(new Value(allKeys[i], bot));

          if(keyVal.value && keyVal.value.enumerable) {
            K.push(new Value(allKeys[i], retLabel));
          }
        }
      }

      var partial = [];
      for(var i = 0; i < K.length; i++) {
        var P = K[i];
        var strP = Str(P, value);

        if(strP && strP.value !== undefined) {
          var member = Quote(P);
          member.value += ":";
          if(gap !== "") {
            member.value += ' ';
          }

          member.value += strP.value;
          partial.push(member);
        }
      }

      var final;
      if(partial.length === 0) {
        final = "{}";
      }
      else {
        var properties = "";
        if(gap === "") {
          for(var i = 0; i < partial.length - 1; i++) {
            properties += partial[i].value + ',';
            retLabel = lub(retLabel, partial[i].label);
          }

          properties += partial[partial.length - 1].value;
          retLabel = lub(retLabel, partial[partial.length - 1].label);

          final = '{' + properties + '}';
        }
        else {
          var separator = ",\n" + indent;

          for(var i = 0; i < partial.length - 1; i++) {
            properties += partial[i].value + separator;
            retLabel = lub(retLabel, partial[i].label);
          }

          properties += partial[partial.length - 1].value;
          retLabel = lub(retLabel, partial[partial.length - 1].label);

          final = '{\n' + indent + properties + '\n' + stepback + '}';
        }
      }

      // Pop and remove JO_property
      var v = stack.pop();
      v.Delete(JO_key);

      indent = stepback;
      return new Value(final, retLabel);
    };

    var JA = function(value) {
      var JA_key = new Value("JA_property", bot);
      if(!value.Get(JA_key).value) {
        JA_counter++;
        value.DefineOwnProperty(JA_key,
                                { value        : new Value(JA_counter, bot),
                                  writable     : false,
                                  enumerable   : false,
                                  configurable : false,
                                  label        : bot
                                },
                                false);
      }
      else {
        checkCycle(JA_key, value);
      }

      stack.push(value);
      var stepback = indent;
      indent = indent + gap;
      var partial = [];

      var len = value.Get(new Value('length', bot));
      var index = new Value(0, bot);

      while(index.value < len.value) {
        var strP = Str(conversion.ToString(index), value);
        if(!strP || strP.value === undefined) {
          partial.push(new Value("null", retLabel));
        }
        else {
          partial.push(strP);
          retLabel = lub(retLabel, strP.label);
        }
        index.value++;
      }

      var final;
      if(partial.length === 0) {
        final = "[]";
      }
      else {
        var properties = "";
        if(gap === "") {
          for(var i = 0; i < partial.length - 1; i++) {
            properties += partial[i].value + ',';
            retLabel = lub(retLabel, partial[i].label);
          }

          properties += partial[partial.length - 1].value;
          retLabel = lub(retLabel, partial[partial.length - 1].label);

          final = '[' + properties + ']';
        }
        else {
          var separator = ",\n" + indent;
          for(var i = 0; i < partial.length - 1; i++) {
            properties += partial[i].value + separator;
            retLabel = lub(retLabel, partial[i].label);
          }

          properties += partial[partial.length - 1].value;
          retLabel = lub(retLabel, partial[partial.length - 1].label);

          final = '[\n' + indent + properties + '\n' + stepback + ']';
        }
      }

      // Pop and remove property of JA_key
      var v = stack.pop();
      v.Delete(JA_key);

      indent = stepback;
      return new Value(final, retLabel);
    };

    var checkCycle = function(key, value) {
      for(var i = 0; i < stack.length; i++) {
        if(value.Get(key).value === stack[i].Get(key).value) {
          monitor.Throw(
            monitor.modules.error.TypeErrorObject,
            'JSON.stringify: Cyclic structure',
            bot
          );
        }
      }
    };

    return Str(new Value("", bot), wrapper);
  };

  return module;
};

},{}],34:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {

  var Set = require('./set').Set;

  exports.Label = Label;
  exports.le    = le;
  exports.lub   = lub;
  exports.glb   = glb;

  // -------------------------------------------------------------------------- 

  function Label() {

    var principals = Array.prototype.slice.call(arguments);

    if (arguments.length === 1) {
      var arg = arguments[0];
      
      if (arg instanceof Array) {
        principals = arg;
      }

      if (arg instanceof Label) {
        principals = arg.principals;
      }
    }

    this.principals = new Set(principals);
  }

  // -------------------------------------------------------------------------- 

  Label.fromString = function(l) {
    return new Label(l.split(','));
  };

  // -------------------------------------------------------------------------- 

  Label.fromURL = function(l) {
    if (l === undefined) {
      monitor.fatal('fromURL: undefined parameter');
    }
    
    var re  = new RegExp('http://[^/]*/');
    var res = re.exec(l);
    if (res === null) {
      return new Label(l.split(','));
    } else {
      return new Label([res[0]]);
    }
  };

  // -------------------------------------------------------------------------- 

  Label.prototype.lub = function() {
    if (this.principals === true) {
      return this;
    }

    for (var i = 0, len = arguments.length; i < len; i++) {
      var l = arguments[i];
      if (l.principals === true) {
        this.principals = true;
        return this;
      }

      this.principals.union(l.principals);
    }
    return this;
  };

  // -------------------------------------------------------------------------- 

  Label.prototype.glb = function() {
    for (var i = 0, len = arguments.length; i < len; i++) {
      var l = arguments[i];
      if (l.principals === true) {
        continue;
      }

      if (this.principals === true) {
        this.principals = l;
        continue;
      }

      this.principals.intersect(l.principals);
    }
    return this;
  };

  // -------------------------------------------------------------------------- 

  Label.prototype.equals = function(x) {

    if (this.principals === true || x.principals === true) {
      return this.principals === x.principals;
    }

    return this.principals.equals(x.principals);
  };

  // -------------------------------------------------------------------------- 

  Label.prototype.le = function (x) {

    if (x.principals === true) {
      return true;
    }

    if (this.principals === true) { 
      return false;
    }

    return x.principals.isSubset(this.principals);
  };

  // -------------------------------------------------------------------------- 

  Label.prototype.toString = function () {
    var str = (this.principals === true) ? 'T' : this.principals.toString();
    return "<" + str + ">";
  };
  
  // -------------------------------------------------------------------------- 

  Label.bot = new Label([]);
  Label.top = (function() { var x = new Label(); x.principals = true; return x; })();
  //Label.top = new Label([]);

  // -------------------------------------------------------------------------- 

  function le(l1,l2) {
      return (l1.le(l2));
  };

  function lub() {
    var l = new Label();
    l.lub.apply(l,arguments);
    return l;
  }

  function glb() {
    var l = new Label(Label.top);
    l.glb.apply(l,arguments);
    return l;
  }

})();

},{"./set":44}],35:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {

  exports.Map = Map;

  function Map(carrier) {
    this.carrier = carrier;

    if (this.carrier === undefined) {
      this.carrier = {};
    }
  }

  Map.fromObject = function(o) {
    var m = new Map();

    for (var x in o) {
      if (o.hasOwnProperty(x)) {
        m.set(x,o[x]);
      }
    }

    return m;
  };

  Map.prototype.has = function(s) {
    return Object.hasOwnProperty.call(this.carrier, s);
  };

  Map.prototype.get = function(s) {

    if (this.has(s)) {
      return this.carrier[s];
    }

    return undefined;
  };

  Map.prototype.set = function(s,v) { 
    this.carrier[s] = v;
  };

  Map.prototype.del = function(s) {
    delete this.carrier[s];
  };

  Map.prototype.keys = function() {
    return Object.getOwnPropertyNames(this.carrier);
  };

  Map.prototype.keysIterator = function() {
    return new MapIterator(this);
  };

  function MapIterator(map) {
    this.map   = map;
    this.index = 0;
    this.data  = [];

    for (var x in map.carrier) {
      if (map.has(x)) {
        this.data.push(x);
      }
    }
  }

  MapIterator.prototype.hasNext = function() {
    return this.index < this.data.length;
  };

  MapIterator.prototype.next = function() {
    return this.data[this.index++];
  };

})();

},{}],36:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 15.8
exports.functor = function(monitor) {

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;
  var Unimplemented   = _function.Unimplemented;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.allocate = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var mathObject = new MathObject(host.Math);
    return { MathObject : mathObject };
  }

  // ------------------------------------------------------------
  // The Math Object, 15.8.2

  function MathObject(host) {
    Ecma.call(this);
    
    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Class      = 'Math';
    // not mandated by standard
    this.Extensible = true; 
    this.host       = host;

    ecma.DefineFFF(this,constants.length, 1);
    ecma.DefineFFF(this,constants.prototype, monitor.instances.ObjectPrototype);

    ecma.DefineFFF(this, constants.E, this.host.E);
    ecma.DefineFFF(this, constants.LN10, this.host.LN10);
    ecma.DefineFFF(this, constants.LN2, this.host.LN2);
    ecma.DefineFFF(this, constants.LOG2E, this.host.LOG2E);
    ecma.DefineFFF(this, constants.LOG10E, this.host.LOG10E);
    ecma.DefineFFF(this, constants.PI, this.host.PI);
    ecma.DefineFFF(this, constants.SQRT1_2, this.host.SQRT1_2);
    ecma.DefineFFF(this, constants.SQRT2, this.host.SQRT2);
    
    ecma.DefineTFT(this, constants.abs   , new BiFO(abs   , 1, this.host.abs));
    ecma.DefineTFT(this, constants.acos  , new BiFO(acos  , 1, this.host.acos));
    ecma.DefineTFT(this, constants.asin  , new BiFO(asin  , 1, this.host.asin));
    ecma.DefineTFT(this, constants.atan  , new BiFO(atan  , 1, this.host.atan));
    ecma.DefineTFT(this, constants.atan2 , new BiFO(atan2 , 2, this.host.atan2));
    ecma.DefineTFT(this, constants.ceil  , new BiFO(ceil  , 1, this.host.ceil));
    ecma.DefineTFT(this, constants.cos   , new BiFO(cos   , 1, this.host.cos));
    ecma.DefineTFT(this, constants.exp   , new BiFO(exp   , 1, this.host.exp));
    ecma.DefineTFT(this, constants.floor , new BiFO(floor , 1, this.host.floor));
    ecma.DefineTFT(this, constants.log   , new BiFO(log   , 1, this.host.log));
    ecma.DefineTFT(this, constants.max   , new BiFO(max   , 2, this.host.max));
    ecma.DefineTFT(this, constants.min   , new BiFO(min   , 2, this.host.min));
    ecma.DefineTFT(this, constants.pow   , new BiFO(pow   , 2, this.host.pow));
    ecma.DefineTFT(this, constants.random, new BiFO(random, 0, this.host.random));
    ecma.DefineTFT(this, constants.round , new BiFO(round , 1, this.host.round));
    ecma.DefineTFT(this, constants.sin   , new BiFO(sin   , 1, this.host.sin));
    ecma.DefineTFT(this, constants.sqrt  , new BiFO(sqrt  , 1, this.host.sqrt));
    ecma.DefineTFT(this, constants.tan   , new BiFO(tan   , 1, this.host.tan));
  }

  prelude.inherits(MathObject,Ecma);

  // ------------------------------------------------------------
  // abs, 15.8.2.1
  var abs = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.abs(x.value), x.label);
  };

  // ------------------------------------------------------------
  // acos, 15.8.2.2
  var acos = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.acos(x.value), x.label);
  };

  // ------------------------------------------------------------
  // asin, 15.8.2.3
  var asin = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.asin(x.value), x.label);
  };

  // ------------------------------------------------------------
  // atan, 15.8.2.4
  var atan = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.atan(x.value), x.label);
  };

  // ------------------------------------------------------------
  // atan2, 15.8.2.5
  var atan2 = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    var y = args[1] ? conversion.ToNumber(args[1]) : new Value(undefined,bot);
    return new Value(_this.host.atan2(x.value,y.value), lub(x.label, y.label));
  };

  // ------------------------------------------------------------
  // ceil, 15.8.2.6
  var ceil = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.ceil(x.value), x.label);
  };

  // ------------------------------------------------------------
  // cos, 15.8.2.7
  var cos = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.cos(x.value), x.label);
  };

  // ------------------------------------------------------------
  // exp, 15.8.2.8
  var exp = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.exp(x.value), x.label);
  };

  // ------------------------------------------------------------
  // floor, 15.8.2.9
  var floor = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.floor(x.value), x.label);
  };

  // ------------------------------------------------------------
  // log, 15.8.2.10
  var log = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.log(x.value), x.label);
  };

  // ------------------------------------------------------------
  // max, 15.8.2.11
  var max = function(thisArg,args) {
    var _this = thisArg.value;
    if (args.length===0) return new Value(Number.NEGATIVE_INFINITY,bot);
    var myArgs=[];
    var l=bot;
    for (var i = 0; i < args.length; i++){
               myArgs[i] = args[i].value;
               l = lub(l,args[i].label);
               }
    return new Value(_this.host.max.apply(null,myArgs), l);
  };

  // ------------------------------------------------------------
  // min, 15.8.2.12
  var min = function(thisArg,args) {
    var _this = thisArg.value;
    if (args.length===0) return new Value(Number.POSITIVE_INFINITY,bot);
    var myArgs=[];
    var l=bot;
    for (var i = 0; i < args.length; i++){
               myArgs[i] = args[i].value;
               l = lub(l,args[i].label);
               }
    return new Value(_this.host.min.apply(null,myArgs), l);
  };

  // ------------------------------------------------------------
  // pow, 15.8.2.13
  var pow = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    var y = args[1] ? conversion.ToNumber(args[1]) : new Value(undefined,bot);
    return new Value(_this.host.pow(x.value,y.value), lub(x.label, y.label));
  };

  // ------------------------------------------------------------
  // random, 15.8.2.14
  var random = function(thisArg,args) {
    var _this = thisArg.value;
    return new Value(_this.host.random(), bot);
  };

  // ------------------------------------------------------------
  // round, 15.8.2.15
  var round = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.round(x.value), x.label);
  };

  // ------------------------------------------------------------
  // sin, 15.8.2.16
  var sin = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.sin(x.value), x.label);
  };

  // ------------------------------------------------------------
  // sqrt, 15.8.2.17
  var sqrt = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.sqrt(x.value), x.label);
  };

  // ------------------------------------------------------------
  // tan, 15.8.2.18
  var tan = function(thisArg,args) {
    var _this = thisArg.value;
    var x = args[0] ? conversion.ToNumber(args[0]) : new Value(undefined,bot);
    return new Value(_this.host.tan(x.value), x.label);
  };

  return module;
};


},{}],37:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function () {

  var imports = {
    esprima      : require('esprima'),
    escodegen    : require('escodegen'),
    estraverse   : require('estraverse'),
    underscore   : require('underscore'),
    'source-map' : require('source-map'),
    util         : require('util'),

    prelude      : require('./prelude'),

    stack        : require('./stack'),
    map          : require('./map'),
    set          : require('./set'),

    opt          : require('./options'),
    pp           : require('./pp'),

    label        : require('./label'),
    values       : require('./values'),
    constants    : require('./constants'),

    context      : require('./context'),

    conversion   : require('./conversion'),
    ecma         : require('./ecma'),
    'function'   : require('./function'),
    object       : require('./object'),
    error        : require('./error'),
    env          : require('./env'),

    bool         : require('./bool'),
    number       : require('./number'),
    string       : require('./string'),
    array        : require('./array'),
    regexp       : require('./regexp'),
    date         : require('./date'),
    math         : require('./math'),
    json         : require('./json'),

    global       : require('./global'),
    exec         : require('./exec')
  };

  var prelude = imports.prelude;
  var bot     = imports.label.Label.bot;

  // --------------------------------------------------------------------------

  exports.Monitor       = Monitor;
  exports.MonitorBase   = MonitorBase;
  exports.SecurityError = SecurityError;

  // --------------------------------------------------------------------------

  function SecurityError(message) {
    this.message = message;
    this.stack   = new Error().stack;
  }

  SecurityError.prototype.toString = function() {
    return this.message;
  };

  // --------------------------------------------------------------------------

  function MonitorBase() {
  
    this.modules = {};
    var load = [
      'esprima',
      'escodegen',
      'estraverse',
      'underscore',
      'source-map',
      'util',
      'prelude',
      'set',
      'map',
      'stack',
      'label',
      'pp',
      'values',
      'constants',
      'context',
      'conversion',
      'ecma',
      'function',
      'object',
      'error',
      'env',
      'bool',
      'number',
      'string',
      'array',
      'regexp',
      'date',
      'math',
      'json',
      'global',
      'exec'
    ];

    this.setup(this.modules, load, imports);

    this.options = new imports.opt.Options();

    this.__defineGetter__('context', 
      function() {
         return this.contextStack.peek();
      }
    );

    this.options.declare('monitor.taintMode', 'boolean', false, 'taint mode');
    //this.options.declare('monitor.taintMode', 'boolean', true, 'taint mode');
    
    this.debug        = {};
    this.debug.active = false;

  }

  MonitorBase.prototype.setup = function(target, load, imports) {

    for (var i = 0, len = load.length; i < len; i++) {
      var name   = load[i];

      var module = imports[name];

      if (typeof module.functor === 'function') {
        target[name] = module.functor(this);
      } else {
        target[name] = module;
      }
    }
  };

  MonitorBase.prototype.initialize = function(global) {
    this.debug.active = false;

    this.contextStack = new imports.stack.Stack();
    // needed to be able to allocate instances, since Ecma
    // reads the effective pc of the context
    var context = new this.modules.context.Context();
    context.owner = '<monitor>';
    this.contextStack.push(context);

    this.instances = {};

    // create instances to make Object.prototype and Function.prototyoe
    // available

    var functionInstances = this.modules['function'].allocate(global.Function);
    prelude.copy(functionInstances, this.instances);

    var objectInstances   = this.modules.object.allocate(global.Object);
    prelude.copy(objectInstances, this.instances);

    // now that Object.prototype is available functions can be setup
    this.modules['function'].setup();    
    var instanceList = [
      this.modules.error,
      this.modules.bool,
      this.modules.number,
      this.modules.string,
      this.modules.array,
      this.modules.regexp,
      this.modules.date,
      this.modules.math,
      this.modules.json
    ];

    for (var i = 0, len = instanceList.length; i < len; i++) {
      var instances = instanceList[i].allocate(global);
      prelude.copy(instances, this.instances);
    }
  };


  MonitorBase.prototype.running = function() {
    return this.modules.exec.running();
  };

  MonitorBase.prototype.execute = function(code, filename) {
    if (!this.initialized) {
      // TODO: throw error
    }
    var ret = this.modules.exec.executeGlobalCode(code,filename);
    return ret;
  };

  MonitorBase.prototype.resume = function() {
    this.debug.active = false;
    return this.modules.exec.resume();
  };

  MonitorBase.prototype.step = function() {
    return this.modules.exec.resume();
  };

  MonitorBase.prototype.printWorkList = function() {
    console.log('context owner: ' + this.context.owner);
    console.log(String(this.context.workList));
  };

  MonitorBase.prototype.require = function(name) {
    var path = name.split('/');
    var current = this.modules;

    for (var i = 0, len = path.length; i < len; i++) {
      if (current === undefined) {
        break;
      }
      current = current[path[i]];
    }

    if (!current) {
      this.fatal('Module ' + name + ' not found');
    }
    return current;
  };

  MonitorBase.prototype.fatal = function(msg) {
    var exc  = new Error(msg);
    exc.type = 'Fatal';
    throw exc;
  };

  MonitorBase.prototype.stop = function (msg) {
    var exc  = new Error(msg);
    exc.type = 'Stop';
    throw exc;
  };

  MonitorBase.prototype.Throw = function (exc,msg,lbl) {

    this.assert(
      this.modules.label.le(this.context.effectivePC, this.context.labels.exc),
      'throw: effective pc ' + this.context.effectivePC + 
      ' not below exception label ' + this.context.labels.exc
    );

    var Value = this.modules.values.Value;
    this.offendingTrace = this.stackTrace();
    throw new Value(new exc(new Value(msg,lbl)), lbl);
  };

  MonitorBase.prototype.stackTrace = function() {
    return new StackTrace(this.contextStack.toArray());
  };

  MonitorBase.prototype.securityError = function(message) {
    var exc = new SecurityError(message);
    throw exc;

   // if (this.options.get('monitor.unsoundMode')) {
   //   this.warn('[Security violation] ' + msg);
   //   this.warn(codeLocation());
   // } else {
   //   var exc  = new Error('[Security violation] ' + msg + '\n');
   //   exc.type = 'Security';
   //   throw exc;
   // }
  };

  MonitorBase.prototype.assert = function(b,msg) {
    if (!b) this.securityError(msg); 
  };

  MonitorBase.prototype.liftException = function(e, Throw) {
    if (e instanceof SecurityError) {
      throw e;
    }

    if (Throw) {
      this.Throw(
        this.modules.error.nativeTable[e.name],
        e.message,
        bot
      );
    }
  };

  // --------------------------------------------------------------------------

  function Monitor(global, log, print, error, warn) {
    MonitorBase.call(this);

    this.log   = log ? log : console.log;
    this.print = print ? print : console.log;
    this.error = error ? error : console.log;
    this.warn  = warn ? warn : console.log;

    this.initialize(global);
  }

  prelude.inherits(Monitor, MonitorBase);

  Monitor.prototype.initialize = function(global) {
    MonitorBase.prototype.initialize.call(this,global);

    var globalInstance = this.modules.global.allocate(global);
    prelude.copy(globalInstance, this.instances);

    this.modules.exec.initialize();
  };

  // --------------------------------------------------------------------------- 

  function StackTrace(stack) {

    this.trace = [];
    for (var i = 0, len = stack.length; i < len; i++) {
      var context = stack[i];

      var stmt = context.currentStatement;
      if (stmt === undefined) {
        break;
      }

      var loc  = stmt.loc;
      var source = loc.source;

      this.trace.push({ owner : context.owner, source : source, loc : loc.start, stmt : stmt });
    }
  }

  StackTrace.prototype.toString = function() {

    if (this.trace.length === 0) {
      return '';
    }
    
    var result;

    var len = this.trace.length;
    // last entry contains offending command
    var last = this.trace[len-1];

    result = last.source + ':' + last.loc.line + ':' + last.loc.column + '\n';
    result = result + '    ' + escodegen.generate(last.stmt) + '\n\n';
    
    for (var i = len-2; i >= 0; i--) {
      var tr = this.trace[i];
      if (tr.owner) {
        result = result + 'at ' + tr.owner + ' ';
      }
      result = result + '(' + tr.source + ':' + tr.loc.line + ':' + tr.loc.column + ')\n';
    }
    return result;
  };

})();

},{"./array":21,"./bool":22,"./constants":23,"./context":24,"./conversion":25,"./date":26,"./ecma":27,"./env":28,"./error":29,"./exec":30,"./function":31,"./global":32,"./json":33,"./label":34,"./map":35,"./math":36,"./number":38,"./object":39,"./options":40,"./pp":41,"./prelude":42,"./regexp":43,"./set":44,"./stack":45,"./string":46,"./values":47,"escodegen":3,"esprima":5,"estraverse":6,"source-map":11,"underscore":20,"util":52}],38:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var error           = monitor.require('error');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;
  var Unimplemented   = _function.Unimplemented;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.NumberObject = NumberObject;
  module.allocate     = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var numberConstructor = new NumberConstructor(host.Number);
    var numberPrototype   = numberConstructor._proto;

    return { NumberConstructor : numberConstructor,
             NumberPrototype   : numberPrototype 
           };
  }

  // ------------------------------------------------------------
  // The Number Constructor, 15.7.2

  function NumberConstructor(host) {
    Ecma.call(this);
    
    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Class      = 'Function';
    // not mandated by standard
    this.Extensible = true;

    this.host = host
    this._proto = new NumberPrototype(this);
    
    ecma.DefineFFF(this, constants.length           , 1);
    ecma.DefineFFF(this, constants.prototype        , this._proto);

    ecma.DefineFFF(this, constants.MAX_VALUE        , this.host.MAX_VALUE);
    ecma.DefineFFF(this, constants.MIN_VALUE        , this.host.MIN_VALUE);
    ecma.DefineFFF(this, constants.NaN              , this.host.NaN);
    ecma.DefineFFF(this, constants.NEGATIVE_INFINITY, this.host.NEGATIVE_INFINITY);
    ecma.DefineFFF(this, constants.POSITIVE_INFINITY, this.host.POSITIVE_INFINITY);
  }

  prelude.inherits(NumberConstructor,Ecma);
  NumberConstructor.prototype.HasInstance = _function.HasInstance;

  // 15.7.1.1
  NumberConstructor.prototype.Call = function(thisArg,args) {
    if (!args[0]) {
      return new Value(0,bot);
    }

    return conversion.ToNumber(args[0]);
  };

  // 15.7.2.1
  NumberConstructor.prototype.Construct = function(args) {
    var arg0 = args[0] ? conversion.ToNumber(args[0]) : new Value(0,bot);
    var res = new NumberObject(arg0.value, arg0.label);
    return new Value(res,bot);
  };
  
  // ------------------------------------------------------------
  // The Number Prototype, 15.7.4
  function NumberPrototype(constructor) {
    Ecma.call(this);
    this.Class          = 'Number';
    this.Prototype      = new Value(monitor.instances.ObjectPrototype,bot);
    this.PrimitiveValue = new Number(0);
    this.PrimitiveLabel = bot;

    this.host = constructor.host.prototype;

    ecma.DefineFFF(this, constants.length        , 0);
    ecma.DefineTFT(this, constants.constructor   , constructor);
    ecma.DefineTFT(this, constants.toString      , new BiFO(toString      , 1, this.host.toString));
    ecma.DefineTFT(this, constants.toLocaleString, new BiFO(toLocaleString, 0, this.host.toLocaleString));
    ecma.DefineTFT(this, constants.valueOf       , new BiFO(valueOf       , 0, this.host.valueOf));
    ecma.DefineTFT(this, constants.toFixed       , new BiFO(toFixed       , 0, this.host.toFixed));
    ecma.DefineTFT(this, constants.toExponential , new BiFO(toExponential , 0, this.host.toExponential));
    ecma.DefineTFT(this, constants.toPrecision   , new BiFO(toPrecision   , 0, this.host.toPrecision));
  }

  prelude.inherits(NumberPrototype,Ecma);

  // ------------------------------------------------------------
  // toString, 15.7.4.2
  var toString = function(thisArg,args) {

    if ( ! (typeof thisArg.value === 'number' || (thisArg.value !== null  && typeof thisArg.value === 'object' && thisArg.value.Class === 'Number'))) {
      monitor.Throw(
        error.TypeErrorObject,
        'Number.prototype.toString is not generic',
        thisArg.label
      );
    }

    var radix = args[0] || new Value(undefined, bot);
    if (radix.value === undefined) {
      radix.value = 10;
    }

    radix = conversion.ToInteger(radix);
    var result;
    if ( typeof thisArg.value === 'number') {
        result = thisArg.value.toString(radix.value);
        return new Value(result, lub(thisArg.label, radix.label));
    }
    else {
        result = thisArg.value.PrimitiveValue.toString(radix.value);
        return new Value(result, lub(thisArg.value.PrimitiveLabel, radix.label));
    }

  };

  // ------------------------------------------------------------
  // toLocaleString, 15.7.4.3
  var toLocaleString = function(thisArg,args) { 
    var O = conversion.ToObject(thisArg);
    var result = O.value.PrimitiveValue.toLocaleString();
    return new Value(result, O.value.PrimitiveLabel);
  }  

  // ------------------------------------------------------------
  // valueOf, 15.7.4.4
  var valueOf = function(thisArg,args) {

    if ( ! (typeof thisArg.value === 'number' || (thisArg.value !== null  && typeof thisArg.value === 'object' && thisArg.value.Class === 'Number'))) {
      monitor.Throw(
        error.TypeErrorObject,
        'Number.prototype.valueOf is not generic',
        thisArg.label
      );
    }

    if (typeof thisArg.value === 'number') {
      return thisArg;
    }

    var result = thisArg.value.PrimitiveValue.valueOf();
    return new Value(result, thisArg.value.PrimitiveLabel);
  };

  // ------------------------------------------------------------
  // toFixed, 15.7.4.5
  var toFixed = function(thisArg,args) {
    var precision = args[0] ? conversion.ToInteger(args[0]) : new Value(undefined,bot);
    conversion.CheckObjectCoercible(thisArg);
    var _this = conversion.ToObject(thisArg);
    return new Value(_this.value.PrimitiveValue.toFixed(precision.value), lub(precision.label, _this.label));
  };

  // ------------------------------------------------------------
  // toExponential, 15.7.4.6
  var toExponential = function(thisArg,args) {
    var precision = args[0] ? conversion.ToInteger(args[0]) : new Value(undefined,bot);
    conversion.CheckObjectCoercible(thisArg);
    var _this = conversion.ToObject(thisArg);
    return new Value(_this.value.PrimitiveValue.toExponential(precision.value), lub(precision.label, _this.label));
  };

  // ------------------------------------------------------------
  // toPrecision, 15.7.4.7
  var toPrecision = function(thisArg,args) {
    var precision = args[0] ? args[0] : new Value(undefined,bot);
    var lbl = lub(precision.label, thisArg.label);
    if (precision.value === undefined) {
        var strX = conversion.ToString(thisArg); //step 2
        return new Value(strX.value,lbl);
    }
    var p = conversion.ToInteger(precision); //step 3
    if (thisArg.value === NaN) return new Value('NaN', lbl); //step 4

    return new Value(thisArg.value.toPrecision(precision.value), lbl);
  };


  // ------------------------------------------------------------
  // Number Object, 15.7.5

  function NumberObject(val,lbl) {
    Ecma.call(this);

    this.Class          = 'Number';
    this.PrimitiveValue = new Number(val);
    this.PrimitiveLabel = lbl;
    this.Extensible     = true;
    this.Prototype      = new Value(monitor.instances.NumberPrototype,bot);
  };
  
  prelude.inherits(NumberObject,Ecma);

  // ---

  NumberObject.prototype.toNative = function(deep) {
    var v = new Number(this.PrimitiveValue);
    return new Value(v, this.PrimitiveLabel);
  };

  // ---
  return module;
};


},{}],39:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 15.2
exports.functor = function(monitor) {
  
  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.ObjectObject = ObjectObject;
  module.allocate     = allocate;

  // ------------------------------------------------------------
  
  function allocate(host) {
    var objectConstructor = new ObjectConstructor(host);
    var objectPrototype   = objectConstructor._proto;
    return { ObjectConstructor : objectConstructor,
             ObjectPrototype   : objectPrototype
           };
  }


  // ------------------------------------------------------------
  // Object Constructor, 15.2.3

  function ObjectConstructor(host) {
    Ecma.call(this);

    this.Class  = 'Function';
    this.host   = host;
    this._proto = new ObjectPrototype(this);

    // 15.2.3
    this.Prototype = new Value(monitor.instances.FunctionPrototype,bot);

    ecma.DefineFFF(this, constants.length,1);
    // 15.2.3.1
    ecma.DefineFFF(this, constants.prototype, this._proto);

    ecma.DefineTFT(this, constants.getPrototypeOf          , new BiFO(getPrototypeOf          , 1, Object.getPrototypeOf));
    ecma.DefineTFT(this, constants.getOwnPropertyDescriptor, new BiFO(getOwnPropertyDescriptor, 2, Object.getOwnPropertyDescriptor));
    ecma.DefineTFT(this, constants.getOwnPropertyNames     , new BiFO(getOwnPropertyNames     , 1, Object.getOwnPropertyNames));
    ecma.DefineTFT(this, constants.create                  , new BiFO(create                  , 2, Object.create));
    ecma.DefineTFT(this, constants.defineProperty          , new BiFO(defineProperty          , 3, Object.defineProperty));
    ecma.DefineTFT(this, constants.defineProperties        , new BiFO(defineProperties        , 2, Object.defineProperties));
    ecma.DefineTFT(this, constants.seal                    , new BiFO(seal                    , 1, Object.seal));
    ecma.DefineTFT(this, constants.freeze                  , new BiFO(freeze                  , 1, Object.freeze));
    ecma.DefineTFT(this, constants.preventExtensions       , new BiFO(preventExtensions       , 1, Object.preventExtensions));
    ecma.DefineTFT(this, constants.isSealed                , new BiFO(isSealed                , 1, Object.isSealed));
    ecma.DefineTFT(this, constants.isFrozen                , new BiFO(isFrozen                , 1, Object.isFrozen));
    ecma.DefineTFT(this, constants.isExtensible            , new BiFO(isExtensible            , 1, Object.isExtensible));
    ecma.DefineTFT(this, constants.keys                    , new BiFO(keys                    , 1, Object.keys));

  }

  prelude.inherits(ObjectConstructor, Ecma);

  ObjectConstructor.prototype.HasInstance = _function.HasInstance;

  // ------------------------------------------------------------
  // 15.2.1.1
  ObjectConstructor.prototype.Call = function(thisArg,args) {
    var arg0 = args[0] || new Value(undefined,bot);

    var res;
    monitor.context.pushPC(arg0.label);
    if (arg0.value === undefined || arg0.value === null) {
      res = this.Construct(args);
      res.raise(arg0.label);
      monitor.context.popPC();
      return res;
    }

    res = conversion.ToObject(arg0);
    monitor.context.popPC();
    return res;
  };

  // ------------------------------------------------------------
  // 15.2.2.1
  ObjectConstructor.prototype.Construct = function(args) {

    var arg0 = args[0] || new Value(undefined,bot);
    
    monitor.context.pushPC(arg0.label);

    var res;
    if (arg0.value === undefined || arg0.value === null) {
      var o = new ObjectObject();

      res = new Value(o,arg0.label);
      monitor.context.popPC();
      return res;
    }

    if (typeof arg0.value === 'object') {
      res = new Value(arg0.value,arg0.label);
      monitor.context.popPC();
      return res;
    }

    res = conversion.ToObject(arg0);
    monitor.context.popPC();
    return res;
  };

  // ------------------------------------------------------------
  
  function assertObject(arg, callee){

    if (typeof arg.value !== 'object') {
      monitor.context.pushPC(arg.label);

      monitor.Throw(
        monitor.modules.error.TypeErrorObject,
        callee + ' called on non-object',
        arg.label
      );
    }

  }

  // ------------------------------------------------------------
  // 15.2.3.2
  function getPrototypeOf(thisArg,args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.getPrototypeOf');

    var proto = O.value.Prototype;
    return new Value(proto.value, lub(proto.label, O.label));
  }

  // ------------------------------------------------------------
  // 15.2.3.3

  var getOwnPropertyDescriptor =  function(thisArg, args) {
    var O = args[0] || new Value(undefined,bot);
    var P = args[1] || new Value(undefined,bot);
    assertObject(O, 'Object.getOwnPropertyDescriptor');
    
    var name = conversion.ToString(P);
    var desc = O.GetOwnProperty(name);

    if (desc.value === undefined) {
      return desc;
    }

    var obj = new ObjectObject();
    if (ecma.IsDataDescriptor(desc.value)) {
      obj.DefineOwnProperty(
        constants.value,
        { value : desc.value.value,
          writable : true, enumerable : true, configurable : true,
          label : desc.value.label
        },
        false
      );

      obj.DefineOwnProperty(
        constants.writable,
        { value : desc.value.writable,
          writable : true, enumerable : true, configurable : true,
          label : desc.value.label
        },
        false
      );
    } else {
      var get = desc.value.get ? desc.value.get.actualFunction : desc.value.get;
      obj.DefineOwnProperty(
        constants.get,
        { value : get,
          writable : true, enumerable : true, configurable : true,
          label : desc.value.label
        },
        false
      );

      var set = desc.value.set ? desc.value.set.actualFunction : desc.value.set;
      obj.DefineOwnProperty(
        constants.set,
        { value : set,
          writable : true, enumerable : true, configurable : true,
          label : desc.value.label
        },
        false
      );
    }

    obj.DefineOwnProperty(
      constants.enumerable,
      { value : desc.value.enumerable,
        writable : true, enumerable : true, configurable : true, 
        label : desc.value.label
      },
      false
    );

    obj.DefineOwnProperty(
      constants.configurable,
      { value : desc.value.configurable,
        writable : true, enumerable : true, configurable : true,
        label : desc.value.label
      },
      false
    );
    
    return new Value(obj,desc.label);
  };
    

  // ------------------------------------------------------------
  // 15.2.3.4

  function getOwnPropertyNames(thisArg, args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.getOwnPropertyNames');
    
    var propertyNames = O.value.getOwnPropertyNames(O.label);
    var array = monitor.modules.array.ArrayObject.fromPropertyArray(propertyNames,O.value.struct);
    return new Value(array,bot);
  }

  // ------------------------------------------------------------
  // 15.2.3.5

  function create(thisArg, args) {
    var O          = args[0] || new Value(undefined,bot);
    var Properties = args[1] || new Value(undefined,bot);

    if (O.value !== null) {
      assertObject(O, 'Object.create');
    }

    var obj = new monitor.modules.object.ObjectObject();
    obj.Prototype = O;
    obj = new Value(obj,bot);
    
    if (Properties.value !== undefined) {
      defineProperties(thisArg, [ obj, Properties ]);
    }
    return obj;
  }

  // ------------------------------------------------------------

  function ToPropertyDescriptor(Obj) {
    assertObject(Obj, 'Object.ToPropertyDescriptor');

    var c = monitor.context;

    var lbl  = new Label();
    var desc = {};

    var b;
    var x;
    var propertyName;
    
    // enumerable
    propertyName = constants.enumerable;
    b = Obj.HasProperty(propertyName);

    lbl.lub(b.label);
    if (b.value) {
      c.pushPC(b.label);
        x = conversion.ToBoolean(Obj.Get(propertyName));
      c.popPC();
      lbl.lub(x.label);
      desc[propertyName.value] = x.value;
    }

    // configurable
    propertyName = constants.configurable;
    b = Obj.HasProperty(propertyName);

    lbl.lub(b.label);
    if (b.value) {
      c.pushPC(b.label);
        x = conversion.ToBoolean(Obj.Get(propertyName));
      c.popPC();
      lbl.lub(x.label);
      desc[propertyName.value] = x.value;
    }

    // value
    propertyName = constants.value;
    b = Obj.HasProperty(propertyName);

    lbl.lub(b.label);
    if (b.value) {
      c.pushPC(b.label);
        x = Obj.Get(propertyName);
      c.popPC();
      lbl.lub(x.label);
      desc[propertyName.value] = x.value;
    }

    // writable
    propertyName = constants.writable;
    b = Obj.HasProperty(propertyName);

    lbl.lub(b.label);
    if (b.value) {
      c.pushPC(b.label);
        x = conversion.ToBoolean(Obj.Get(propertyName));
      c.popPC();
      lbl.lub(x.label);
      desc[propertyName.value] = x.value;
    }

    // get
    propertyName = constants.get;
    b = Obj.HasProperty(propertyName);

    lbl.lub(b.label);
    if (b.value) {
      c.pushPC(b.label);
        x = Obj.Get(propertyName);
      c.popPC();
      lbl.lub(x.label);
      desc[propertyName.value] = x.value;
    }

    // set
    propertyName = constants.set;
    b = Obj.HasProperty(propertyName);

    lbl.lub(b.label);
    if (b.value) {
      c.pushPC(b.label);
        x = Obj.Get(propertyName);
      c.popPC();
      lbl.lub(x.label);
      desc[propertyName.value] = x.value;
    }

    desc.label = lbl;
    return desc;
  }


  // ------------------------------------------------------------
  // 15.2.3.6

  function defineProperty(thisArg,args) {
    var O = args[0] || new Value(undefined,bot);
    var P = args[1] || new Value(undefined,bot);
    var Attributes = args[2] || new Value(undefined,bot);
    assertObject(O, 'Object.defineProperty');
   
    var name = conversion.ToString(P);
    var desc = ToPropertyDescriptor(Attributes);
    O.DefineOwnProperty(name,desc,true);
    return O;
  }

  // ------------------------------------------------------------
  // 15.2.3.7

  function defineProperties(thisArg,args) {
    var O          = args[0] || new Value(undefined,bot);
    var Properties = args[1] || new Value(undefined,bot);

    assertObject(O, 'Object.defineProperties');
    var props = conversion.ToObject(Properties);
    var names = props.value.getOwnEnumerablePropertyNames(props.label);

    var descriptors = [];

    for (var i = 0, len = names.length; i < len; i++) {
      var P = names[i];
      var descObject = props.Get(P);
      var desc       = ToPropertyDescriptor(descObject);
  
      descriptors.push(P);
      descriptors.push(desc);
    }

    for (var i = 0, len = descriptors.length; i < len; i = i + 2) {
      var P    = descriptors[i];
      var desc = descriptors[i+1];
      O.DefineOwnProperty(P,desc,true);
    }
    
    return O;
  }
 
  // ------------------------------------------------------------
  // 15.2.3.8

  function seal(thisArg, args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.defineProperties');

    var context = lub(monitor.context.effectivePC, O.label);

    monitor.assert(
      le(context, O.value.struct),
      'Object.seal: context label ' + context + ' not below structural label ' + O.value.struct + ' of object'
    );

    var labels = O.value.labels;
    for (var x in labels) {
      if (Object.hasOwnProperty.call(labels, x)) {
        monitor.assert(
          le(context, labels[x].value),
          'Object.seal: context label ' + context + ' not below label ' + labels[x].value + ' of ' + x
        );
      }
    }

    Object.seal(O.value.properties);
    O.value.Extensible = false;
    return O;
  }

  // ------------------------------------------------------------
  // 15.2.3.9

  function freeze(thisArg, args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.freeze');

    var context = lub(monitor.context.effectivePC, O.label);

    monitor.assert(
      le(context, O.value.struct),
      'Object.freeze: context label ' + context + ' not below structural label ' + O.value.struct + ' of object'
    );

    var labels = O.value.labels;
    var properties = O.value.properties;

    for (var x in properties) {
      if (Object.hasOwnProperty.call(properties, x)) {
        var desc = Object.getOwnPropertyDescriptor(properties, x);
        if (desc.enumerable) {
          monitor.assert(
            le(context, labels[x].value),
            'Object.freeze: context label ' + context + ' not below label ' + labels[x].value + ' of ' + x
          );
        }
      }
    }

    Object.freeze(O.value.properties);
    O.value.Extensible = false;
    return O;

  }

  // ------------------------------------------------------------
  // 15.2.3.10

  function preventExtensions(thisArg,args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.preventExtensions');

    var context = lub(monitor.context.effectivePC, O.label);

    monitor.assert(
      le(context, O.value.struct),
      'Object.preventExtensions: context label ' + context + ' not below structural label ' + O.value.struct + ' of object'
    );

    Object.preventExtensions(O.value.properties);
    O.value.Extensible = false;
    return O;
  }

  // ------------------------------------------------------------
  // 15.2.3.11

  function isSealed(thisArg,args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.isSealed');

    var result = Object.isSealed(O.value.properties);
    return new Value(result,lub(O.label, O.value.struct));
  }
    

  // ------------------------------------------------------------
  // 15.2.3.12

  function isFrozen(thisArg,args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.isFrozen');

    var result = Object.isFrozen(O.value.properties);
    return new Value(result,lub(O.label, O.value.struct));
  }

  // ------------------------------------------------------------
  // 15.2.3.13

  function isExtensible(thisAr,args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.isExtensible');

    var result = Object.isExtensible(O.value.properties);
    return new Value(result,lub(O.label, O.value.struct));

  }

  // ------------------------------------------------------------
  // 15.2.3.14
  function keys(thisArg,args) {
    var O = args[0] || new Value(undefined,bot);
    assertObject(O, 'Object.keys');

    var enumerable = O.value.getOwnEnumerablePropertyNames(O.label);
    var array = monitor.modules.array.ArrayObject.fromPropertyArray(enumerable,O.value.struct);

    return new Value(array,bot);
  }
  
  // ------------------------------------------------------------
  // The object prototype, 15.2.4

  function ObjectPrototype(constructor) {
    Ecma.call(this);
    this.Prototype  = new Value(null,bot);
    this.Class      = 'Object';
    this.Extensible = true;
  
    this.host = constructor.host.prototype;

    // 15.2.4.1
    ecma.DefineTFT(this, constants.constructor, constructor);

    ecma.DefineTFT(this, constants.toString            , new BiFO(toString            , 0, Object.prototype.toString));
    ecma.DefineTFT(this, constants.toLocaleString      , new BiFO(toLocaleString      , 0, Object.prototype.toLocaleString));
    ecma.DefineTFT(this, constants.valueOf             , new BiFO(valueOf             , 0, Object.prototype.valueOf));
    ecma.DefineTFT(this, constants.hasOwnProperty      , new BiFO(hasOwnProperty      , 1, Object.prototype.hasOwnProperty));
    ecma.DefineTFT(this, constants.isPrototypeOf       , new BiFO(isPrototypeOf       , 1, Object.prototype.isPrototypeOf));
    ecma.DefineTFT(this, constants.propertyIsEnumerable, new BiFO(propertyIsEnumerable, 1, Object.prototype.propertyIsEnumerable));
  }

  prelude.inherits(ObjectPrototype, Ecma); 
  
  // ------------------------------------------------------------
  // Object.prototype.toString(), 15.2.4.2
  function toString(thisArg,args) {
    
    if (thisArg.value === undefined) 
      return new Value('[object Undefined]', thisArg.label);
    
    if (thisArg.value === null)
      return new Value('[object Null]', thisArg.label);
  
    var O = conversion.ToObject(thisArg);
    return new Value('[object ' + O.value.Class + ']', thisArg.label);
  }
  
  // ------------------------------------------------------------
  // 15.2.4.3

  function toLocaleString(thisArg,args) {
    var O = conversion.ToObject(thisArg);
    var toString = O.Get(constants.toString);
    var b = conversion.IsCallable(toString);

    var result; 

    monitor.context.pushPC(b.label);
    if (b.value) {
      result = toString.Call(O);
      result.raise(b.label);
    } else {
      monitor.Throw(
        monitor.modules.error.TypeError,
        "property 'toString' of object " + O + " is not a function ",
        bot
      );
    }
    monitor.context.popPC();

    return result;
  }

  // ------------------------------------------------------------
  // 15.2.4.4

  function valueOf(thisArg) {
    var o = conversion.ToObject(thisArg);
    return o;
  }

  // ------------------------------------------------------------
  // 15.2.4.5

  function hasOwnProperty(thisArg, args) {
    var V = args[0] || new Value(undefined,bot);
    var P = conversion.ToString(V);
    var O = conversion.ToObject(thisArg);
  
    var desc = O.GetOwnProperty(P);
    var result = desc.value !== undefined;

    return new Value(result, desc.label);
  }

  // ------------------------------------------------------------
  // 15.2.4.6

  function isPrototypeOf(thisArg,args) {
    var c = monitor.context;

    var V = args[0] || new Value(undefined,bot);

    if (V.value === null || typeof V.value !== 'object') {
      return new Value(false, V.label);
    }

    c.pushPC(V.label);
    var O = conversion.ToObject(thisArg);
    c.popPC();

    var lbl = new Label();
    lbl.lub(V.label);

    while(true) {
      V = V.value.Prototype;
      lbl.lub(V.label);
      if (V.value === null) {
        return new Value(false, lbl);
      }

      if (O.value === V.value) {
        return new Value(true, lbl);
      }

      if (V === undefined) {
        throw new Error('Object.prototype.isPrototypeOf: object with undefined prototype');
      }
    }
  }

  // ------------------------------------------------------------
  // 15.2.4.7

  function propertyIsEnumerable(thisArg,args) {
    var V = args[0] || new Value(undefined,bot);
    var P = conversion.ToString(V);
    var O = conversion.ToObject(thisArg);

    var desc = O.GetOwnProperty(P);
    if (desc.value === undefined) {
      return new Value(false, desc.label);
    }

    return new Value(desc.value.vale, lub(desc.label, desc.value.label));
  }

  // ------------------------------------------------------------
  // Object objects, 15.2.2.1

  function ObjectObject() {
    Ecma.call(this); 
  
    this.Prototype = new Value(monitor.instances.ObjectPrototype,bot);
    this.Class     = 'Object';
    this.Extensible = true;

    this.host      = {};
  }
    
  prelude.inherits(ObjectObject, Ecma);

  // ---

  ObjectObject.prototype.toString = function() {
    var properties = [];
    for (x in this.properties) {
      if (this.properties.hasOwnProperty(x)) {
        properties.push(x + ': ' + this.properties[x]);
      }
    }
    return '{' + properties.join(', ') + '}';
  };

  return module; 
};


},{}],40:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {

  function Option(type, val, desc) {

    this.type = type;
    this.set(val);
    this.def = this.value;

    this.description = desc;
  }

  Option.prototype.set = function(val) {

    var v = String(val);

    if (this.type === 'string') {

      this.value = v;

    } else if (this.type === 'boolean') {

      this.value = v === 'true' || v === '1';

    } else if (this.type === 'number') {

      this.value = Number(v);

    }
  };

  Option.prototype.getDefault = function() {
    return this.def;
  };

  Option.prototype.valueOf = function() {
    return this.value;
  };

  Option.prototype.toString = function() {
    return String(this.value);
  };

  // -------------------------------------------------------------
  // Options

  function Options() {
    this.options = [];
  }

  Options.prototype.declare = function(name, type, def, desc) { 
    var description = desc ? desc : name;
    this.options[name] = new Option(type, def, description);
  };

  Options.prototype.has = function(name) {
    return this.options[name] !== undefined;
  };

  Options.prototype.get = function(name) {
    return this.options[name].valueOf();
  };

  Options.prototype.getOption = function(name) {
    return this.options[name];
  };

  Options.prototype.set = function(name, value) {
    this.options[name].set(value);
  };

  Options.prototype.keys = function() {
    var res = [];
    for (var x in this.options) {
      if (this.options.hasOwnProperty(x)) {
        res.push(x);
      }
    }
    return res;
  };

  exports.Options = Options;

})();

},{}],41:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  escodegen = monitor.require('escodegen');

  var module = {};

  module.pretty = escodegen.generate;

  return module; 
};

},{}],42:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function () {

  exports.inherits = inherits;
  exports.copy     = copy;
  
  function inherits(tgt,src) {
    for (var x in src.prototype) {
      if (src.prototype.hasOwnProperty(x) &&
        !tgt.prototype.hasOwnProperty(x)) {
        tgt.prototype[x] = src.prototype[x];
      }
    }
  }

  function copy(src,tgt) {
    for (var x in src) {
      if (src.hasOwnProperty(x)) {
        tgt[x] = src[x];
      }
    }
  }

})();

},{}],43:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var prelude         = monitor.require('prelude');
  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var _               = monitor.require('underscore');
  var ecma            = monitor.require('ecma');
  var _function       = monitor.require('function');

  var BiFO            = _function.BuiltinFunctionObject;
  var Value           = monitor.require('values').Value;

  var Label           = label.Label;
  var lub             = label.lub;
  var glb             = label.glb;
  var le              = label.le;

  var bot             = Label.bot;

  // ------------------------------------------------------------
  
  var module = {};
  module.RegExpObject = RegExpObject;
  module.allocate     = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var regExpConstructor = new RegExpConstructor(host.RegExp);
    var regExpPrototype   = regExpConstructor._proto;
    return { RegExpConstructor : regExpConstructor,
             RegExpPrototype   : regExpPrototype
           };
  }

  // ------------------------------------------------------------
  // The RegExp Constructor, 15.10.5

  function RegExpConstructor(host) {
    ecma.Ecma.call(this);
    
    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Class      = 'Function';
    // not mandated by standard
    this.Extensible = true;
    this.host       = host;
    this._proto     = new RegExpPrototype(this, host.prototype);



    ecma.DefineFFF(this,constants.length,2);
    ecma.DefineFFF(this,constants.prototype,this._proto);
  }

  prelude.inherits(RegExpConstructor,ecma.Ecma);
  RegExpConstructor.prototype.HasInstance = _function.HasInstance;

  // 15.10.3.1
  RegExpConstructor.prototype.Call = function(thisArg,args) {
    var pattern = args[0] || new Value(undefined,bot);
    var flags   = args[1] || new Value(undefined,bot);

    if ( pattern.value &&
         typeof pattern.value === 'object' && 
         pattern.value.Class === 'RegExp'  &&
         flags.value === undefined
       ) 
    {
      return pattern;
    }

    return RegExpConstructor.prototype.Construct(args);
  };

  // 15.10.4.1
  RegExpConstructor.prototype.Construct = function(args) {
    var c = monitor.context;

    var pattern = args[0] || new Value(undefined,bot);
    var flags   = args[1] || new Value(undefined,bot);

    var P  = "";
    var F  = "";
    
    var l = lub(pattern.label, flags.label);
    c.pushPC(l);

      if (pattern.value && 
          typeof pattern.value === 'object' && 
          pattern.value.Class === 'RegExp') {
        if (flags.value === undefined) {
          var rx = pattern.value.PrimitiveValue; 
          P = rx.source;
          F = (rx.global ? 'g' : '') + (rx.ignoreCase ? 'i' : '') + (rx.multiline ? 'm' : '');
        }
        else {
          monitor.Throw(
            monitor.modules.error.TypeErrorObject,
            '',
            bot
          );
        } 
      } else {
        var _P = pattern.value === undefined ? new Value("",l) : conversion.ToString(pattern);
        var _F = flags.value === undefined ? new Value("",l) : conversion.ToString(flags);

        l  = lub(l,_P.label,_F.label);
        P = _P.value;
        F = _F.value;
      }

      var res = new RegExpObject(new RegExp(P,F),l);

    c.popPC();
    return new Value(res,bot);
  };
  
  // ------------------------------------------------------------
  // The RegExp Prototype, 15.10.6
  function RegExpPrototype(constructor, host) {
    ecma.Ecma.call(this);
    this.Class          = 'RegExp';
    this.Prototype      = new Value(monitor.instances.ObjectPrototype,bot);

    this.host           = host;

    ecma.DefineFFF(this , constants.source      , '');
    ecma.DefineFFF(this , constants.global      , false);
    ecma.DefineFFF(this , constants.ignoreCase  , false);
    ecma.DefineFFF(this , constants.multiline   , false);
    ecma.DefineTFF(this , constants.lastIndex   , 0);

    ecma.DefineFFF(this , constants.length      , 0);
    ecma.DefineTFT(this , constants.constructor , constructor);

    ecma.DefineTFT(this , constants.exec        , new BiFO(exec     , 1 , RegExp.prototype.exec));
    ecma.DefineTFT(this , constants.test        , new BiFO(test     , 1 , RegExp.prototype.test));
    ecma.DefineTFT(this , constants.toString    , new BiFO(toString , 0 , RegExp.prototype.toString));
  }

  prelude.inherits(RegExpPrototype,ecma.Ecma);


  // ------------------------------------------------------------
  // exec, 15.10.6.2
  var exec = function(thisArg,args){
    var string = args[0] || new Value(undefined,bot);
    var S         = conversion.ToString(string);

    var lastIndex = conversion.ToInteger(thisArg.Get(constants.lastIndex));

    var pre = thisArg.value.PrimitiveValue;
    pre.lastIndex = lastIndex.value;

    var res = pre.exec(S.value);
  
    var l = lub(thisArg.label, S.label, lastIndex.label);

    if (res === null) {
      return new Value(null,l);
    }

    thisArg.Put(constants.lastIndex, new Value(pre.lastIndex,l));

    var array = monitor.modules.array.ArrayObject.fromArray(res,l,l);

    array.DefineOwnProperty(constants.index, 
      { value        : res.index,
        writable     : true,
        enumerable   : true,
        configurable : true,
        label        : l
      }
    );

    array.DefineOwnProperty(constants.input,
      { value        : res.input,
        writable     : true,
        enumerable   : true,
        configurable : true,
        label        : l
      }
    );

    return new Value(array,bot);
  };

  // ------------------------------------------------------------
  // test, 15.10.6.3
  var test = function(thisArg,args){
    var res = exec(thisArg,args);
    return new Value(res.value !== null, res.label);
  };

  // ------------------------------------------------------------
  // toString, 15.10.6.3
  var toString = function(thisArg,args){
        return new Value(thisArg.value.PrimitiveValue.toString(),thisArg.label); 
  };

  // ------------------------------------------------------------
  // RegExp Object, 15.10.4.1

  function RegExpObject(nativeRegExp, l) {
    ecma.Ecma.call(this);

    this.Class          = 'RegExp';
    this.PrimitiveValue = nativeRegExp;
    this.PrimitiveLabel = l;

    this.Extensible     = true;
    this.Prototype      = new Value(monitor.instances.RegExpPrototype,bot);

    this.DefineOwnProperty(constants.source,
      { value        : this.PrimitiveValue.source,
        writable     : false,
        enumerable   : false,
        configurable : false,
        label        : l
      }
    );

    this.DefineOwnProperty(constants.global,
      { value        : this.PrimitiveValue.global,
        writable     : false,
        enumerable   : false,
        configurable : false,
        label        : l
      }
    );

    this.DefineOwnProperty(constants.ignoreCase,
      { value        : this.PrimitiveValue.ignoreCase,
        writable     : false,
        enumerable   : false,
        configurable : false,
        label        : l
      }
    );

    this.DefineOwnProperty(constants.multiline,
      { value        : this.PrimitiveValue.multiline,
        writable     : false,
        enumerable   : false,
        configurable : false,
        label        : l
      }
    );

    this.DefineOwnProperty(constants.lastIndex,
      { value        : this.PrimitiveValue.lastIndex,
        writable     : true,
        enumerable   : false,
        configurable : false,
        label        : l
      }
    );


  }
  
  prelude.inherits(RegExpObject,ecma.Ecma);

  RegExpObject.prototype.toString = function() {
    var v = this.PrimitiveValue.toString();
    return v;
  };

  return module;
};


},{}],44:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {

  // -------------------------------------------------------------------------- 
  
  function Set() {

    this.data = {};

    var toAdd = arguments; 

    if (arguments.length === 1) {
      var arg = arguments[0];

      if (arg instanceof Array) {
        toAdd = arg;
      }
    }
    
    for (var i = 0, len = toAdd.length; i < len; i++) {
      var x = toAdd[i];
      if (x instanceof Set) {
        this.union(x);
      } else {
        this.add(x);
      }
    }
  }

  // -------------------------------------------------------------------------- 

  Set.prototype.iter = function(f) {
    for (var e in this.data) {
      if (this.data.hasOwnProperty(e)) {
        f(e);
      }
    }
  };

  // -------------------------------------------------------------------------- 

  Set.prototype.equals = function(x) {
    return (this.isSubset(x) && x.isSubset(this));
  };

  // -------------------------------------------------------------------------- 

  Set.prototype.add = function(x) {
    this.data[x] = true;
  };
  
  // -------------------------------------------------------------------------- 
  
  Set.prototype.union = function(x) {
    for (var e in x.data) {
      if (x.data.hasOwnProperty(e)) {
        this.data[e] = true;
      }
    }
  };

  // -------------------------------------------------------------------------- 

  Set.prototype.del = function(x) {
    delete this.data[x];
  };

  // -------------------------------------------------------------------------- 

  Set.prototype.intersect = function(x) {
    for (var e in this.data) {
      if (this.data.hasOwnProperty(e) && !x.data.hasOwnProperty(e)) {
        this.del(e);
      }
    }
  };

  // -------------------------------------------------------------------------- 

  Set.prototype.isSubset = function(x) {
    for (var e in x.data) {
      if (x.data.hasOwnProperty(e) && !this.data.hasOwnProperty(e)) {
        return false;
      }
    }

    return true;
  };

  // -------------------------------------------------------------------------- 

  Set.prototype.contains = function(x) {
    return this.data.hasOwnProperty(x);
  };
 
  // -------------------------------------------------------------------------- 

  Set.prototype.toString = function() {
    var acc = [];
    for (var x in this.data) {
      if (this.data.hasOwnProperty(x)) {
        acc.push(x);
      }
    }

    if (acc.length === 0) {
      return '';
    }

    var str = acc[0];
    for (var i = 1, len = acc.length; i < len; i++) {
      str += ',' + acc[i];
    }

    return str;
  };

  exports.Set = Set;


})();

},{}],45:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function() {

  exports.Stack = Stack;

  function Stack() {
    this.content = [];
  }

  Stack.prototype.push = function(v) {
    this.content.push(v);
  };

  Stack.prototype.pop = function() {
    return this.content.pop();
  };

  Stack.prototype.peek = function() {
    return this.content[this.content.length-1];
  };

  Stack.prototype.dup = function() {
    this.push(this.peek());
  };

  Stack.prototype.marker = function() {
    return { length : this.content.length };
  };

  Stack.prototype.reset = function(m) {
    this.content.length = m.length;
  };

  Stack.prototype.iter = function(f) {
    for (var i = 0, len = this.content.length; i < len; i++) {
      f(this.content[i]);
    }
  };

  Stack.prototype.map = function(f, m) {
    for (var i = m.length, len = this.content.length; i < len; i++) {
      this.content[i] = f(this.content[i]);
    }
  };

  Stack.prototype.size = function() {
    return this.content.length;
  };

  Stack.prototype.empty = function() {
    return this.content.length === 0;
  };

  Stack.prototype.toArray = function() {
    return this.content.slice(0);
  };

})();

},{}],46:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor) {

  var label           = monitor.require('label');
  var conversion      = monitor.require('conversion');
  var constants       = monitor.require('constants');
  var prelude         = monitor.require('prelude');
  var ecma            = monitor.require('ecma');
  var error           = monitor.require('error');
  var _function       = monitor.require('function');

  var Value           = monitor.require('values').Value;

  var Ecma            = ecma.Ecma;
  var BiFO            = _function.BuiltinFunctionObject;
  var Unimplemented   = _function.Unimplemented;

  var Label           = label.Label;
  var lub             = label.lub;
  var le              = label.le;
  var bot             = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.StringObject = StringObject;
  module.allocate = allocate;

  // ------------------------------------------------------------

  function allocate(host) {
    var stringConstructor = new StringConstructor(host.String);
    var stringPrototype   = stringConstructor._proto;

    return { StringConstructor : stringConstructor,
             StringPrototype   : stringPrototype 
           };
  }

  // ------------------------------------------------------------
  // The String Constructor, 15.5.2

  function StringConstructor(host) {
    Ecma.call(this);
    
    this.Prototype  = new Value(monitor.instances.FunctionPrototype,bot);
    this.Class      = 'Function';
    // not mandated by standard
    this.Extensible = true;

    this.host       = host;
    this._proto     = new StringPrototype(this, host.prototype);

    ecma.DefineFFF(this, constants.length,1);
    ecma.DefineFFF(this, constants.prototype   ,this._proto);
    ecma.DefineTFT(this, constants.fromCharCode, new BiFO(fromCharCode , 1, this.host.fromCharCode));
  }

  prelude.inherits(StringConstructor,Ecma);
  StringConstructor.prototype.HasInstance = _function.HasInstance;

  // 15.5.1.1 -----------------------------------------------------------------
  StringConstructor.prototype.Call = function(thisArg,args) {

    if (!args[0]) {
      return new Value('',bot);
    }

    var str = conversion.ToString(args[0]);
    return str;
  };

  // 15.5.2.1 ----------------------------------------------------------------- 
  StringConstructor.prototype.Construct = function(args) {
    var value = args[0];

    var str;
    if (value) {
      var x = conversion.ToString(value);
      str = new StringObject(x.value, x.label);
    } else {
      str = new StringObject('');
    }
    return new Value(str,bot);
  };
  
  // --------------------------------------------------------------------------
  // fromCharCode, 15.5.3.2 
  var fromCharCode = function(thisArg, args) {

    var lbl   = new Label();
    var _args = [];
    for (var i = 0, len = args.length; i < len; i++) {
      var arg = conversion.ToUInt16(args[i]);
      lbl.lub(arg.label);
      _args[i] = arg.value;
    }   

    var _String = monitor.instances.StringConstructor.host;
    var v = _String.fromCharCode.apply(_String,_args);
    return new Value(v,lbl);
  };

  // ------------------------------------------------------------
  // The String Prototype, 15.5.4
  function StringPrototype(constructor) {
    Ecma.call(this);
    this.Class          = 'String';
    this.PrimitiveValue = '';
    this.PrimitiveLabel = bot;
    this.Prototype      = new Value(monitor.instances.ObjectPrototype,bot);


    this.properties     = new String('');
    this.labels.length  = {
      value     : bot,
      existence : bot
    };

    this.host           = constructor.host.prototype;

    ecma.DefineTFT(this, constants.constructor       ,constructor);
    ecma.DefineTFT(this, constants.toString         , new BiFO(toString         , 0, this.host.toString));
    ecma.DefineTFT(this, constants.valueOf          , new BiFO(valueOf          , 0, this.host.valueOf));
    ecma.DefineTFT(this, constants.charAt           , new BiFO(charAt           , 1, this.host.charAt));
    ecma.DefineTFT(this, constants.charCodeAt       , new BiFO(charCodeAt       , 1, this.host.charCodeAt));
    ecma.DefineTFT(this, constants.concat           , new BiFO(concat           , 1, this.host.concat));
    ecma.DefineTFT(this, constants.indexOf          , new BiFO(indexOf          , 1, this.host.indexOf));
    ecma.DefineTFT(this, constants.lastIndexOf      , new BiFO(lastIndexOf      , 1, this.host.lastIndexOf));
    ecma.DefineTFT(this, constants.localeCompare    , new BiFO(localeCompare    , 1, this.host.localeCompare));
    ecma.DefineTFT(this, constants.match            , new BiFO(match            , 1, this.host.match));
    ecma.DefineTFT(this, constants.replace          , new BiFO(replace          , 2, this.host.replace));
    ecma.DefineTFT(this, constants.search           , new BiFO(search           , 1, this.host.search));
    ecma.DefineTFT(this, constants.slice            , new BiFO(slice            , 2, this.host.slice));
    ecma.DefineTFT(this, constants.split            , new BiFO(split            , 2, this.host.split));
    ecma.DefineTFT(this, constants.substring        , new BiFO(substring        , 2, this.host.substring));
    ecma.DefineTFT(this, constants.toLowerCase      , new BiFO(toLowerCase      , 0, this.host.toLowerCase));
    ecma.DefineTFT(this, constants.toLocaleLowerCase, new BiFO(toLocaleLowerCase, 0, this.host.toLocaleLowerCase));
    ecma.DefineTFT(this, constants.toUpperCase      , new BiFO(toUpperCase      , 0, this.host.toUpperCase));
    ecma.DefineTFT(this, constants.toLocaleUpperCase, new BiFO(toLocaleUpperCase, 0, this.host.toLocaleUpperCase));
    ecma.DefineTFT(this, constants.trim             , new BiFO(trim             , 0, this.host.trim));

    ecma.DefineTFT(this, constants.substr           , new BiFO(substr           , 2, this.host.substr));

  }

  prelude.inherits(StringPrototype,Ecma);

  // ------------------------------------------------------------
  // toString, 15.5.4.2
  var toString = function(thisArg,args) {

    if (typeof thisArg.value === 'string') {
      return thisArg;
    }

    if (typeof thisArg.value !== 'object' || thisArg.value.Class !== 'String') 
    {
      monitor.Throw(
        error.TypeErrorObject,
        'String.prototype.toString is not generic',
        thisArg.label
      );
    }

    var result = thisArg.value.PrimitiveValue.toString();
    return new Value(result, thisArg.value.PrimitiveLabel);
  };

  // ------------------------------------------------------------
  // valueOf, 15.5.4.3
  var valueOf = toString;

  // ------------------------------------------------------------
  // charAt, 15.5.4.4
  var charAt = function(thisArg,args) {
    var pos = args[0] || new Value(undefined,bot);
    conversion.CheckObjectCoercible(thisArg);
    var S        = conversion.ToString(thisArg);
    var position = conversion.ToInteger(pos);

    var c = S.value.charAt(position.value);
    return new Value(c,lub(position.label,S.label));
  };

  // ------------------------------------------------------------
  // charCodeAt, 15.5.4.5
  var charCodeAt = function(thisArg, args) {
    var pos = args[0] || new Value(undefined,bot);
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var position = conversion.ToInteger(pos);

    var c = S.value.charCodeAt(position.value);
    return new Value(c, lub(position.label, thisArg.label));
  };

  // ------------------------------------------------------------
  // concat, 15.5.4.6
  var concat = function(thisArg, args) {
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var lbl = new Label();
    var _args = [];
    for (var i = 0, len = args.length; i < len; i++) {
      var arg = conversion.ToString(args[i]); 
      lbl.lub(arg.label);
      _args[i] = arg.value;
    }
    var str = S.value.concat.apply(S.value, _args);
    lbl.lub(thisArg.label);
    return new Value(str, lbl);
  };

  // ------------------------------------------------------------
  // indexOf, 15.5.4.7
  var indexOf = function(thisArg, args) {
    var searchString = args[0] || new Value(undefined,bot);
    var position     = args[1] || new Value(0,bot);
    
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var searchStr = conversion.ToString(searchString);
    var pos = conversion.ToInteger(position);
  
    var lbl = lub(S.label,searchStr.label,pos.label);
    var str = S.value.indexOf(searchStr.value,pos.value);

    return new Value(str,lbl);
  };

  // ------------------------------------------------------------
  // lastIndexOf, 15.5.4.8
  var lastIndexOf = function(thisArg, args) {
    var searchString = args[0] || new Value(undefined,bot);
    var position     = args[1] || new Value(undefined,bot);
    
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var searchStr = conversion.ToString(searchString);
    var pos = conversion.ToInteger(position);
  
    var lbl = lub(S.label,searchStr.label,pos.label);
    var str = S.value.lastIndexOf(searchStr.value,pos.value);

    return new Value(str,lbl);
  };

  // ------------------------------------------------------------
  // localeCompare, 15.5.4.9
  var localeCompare = function(thisArg, args) {
    var that = args[0] || new Value(undefined,bot);

    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    that = conversion.ToString(that);
   
    var lbl = lub(S.label,that.label);
    var result = S.value.localeCompare(that.value);
    
    return new Value(result,lbl);
  };

  // ------------------------------------------------------------
  // match, 15.5.4.10
  var match = function(thisArg,args) {
    var regexp = args[0] || new Value(undefined,bot);

    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);

    var rx = regexp;
    if (rx.value === null || typeof rx.value !== 'object'  || rx.value.Class !== 'RegExp') {
      rx = monitor.instances.RegExpConstructor.Construct([regexp]);
    }

    var lbl = lub(S.label, rx.value.PrimitiveLabel);
    monitor.assert(
      le(rx.label, rx.value.PrimitiveLabel),
      'String.prototype.match: label of regular expression object not below regular expression label'
    );

    rx.value.PrimitiveLabel = lbl;
    var primitiveArray = S.value.match(rx.value.PrimitiveValue);
    
    if (primitiveArray === null) {
      return new Value(null,lbl);
    }

    var array = monitor.modules.array.ArrayObject.fromArray(primitiveArray,lbl,lbl);

    array.DefineOwnProperty(constants.index, 
      { value        : primitiveArray.index,
        writable     : true,
        enumerable   : true,
        configurable : true,
        label        : lbl
      }
    );

    array.DefineOwnProperty(constants.input,
      { value        : primitiveArray.input,
        writable     : true,
        enumerable   : true,
        configurable : true,
        label        : lbl
      }
    );

    return new Value(array, bot);
  };

  // ------------------------------------------------------------
  // replace, 15.5.4.11
  var replace = function(thisArg, args) {
    var searchValue  = args[0] || new Value(undefined, bot);
    var replaceValue = args[1] || new Value(undefined, bot);
    
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    
    var sV, rV;

    if (typeof searchValue.value === 'object' && searchValue.value.Class === 'RegExp') {
      sV = searchValue.value.PrimitiveValue;
    } else { 
      searchValue = conversion.ToString(searchValue);
      sV = searchValue.value;
    }

    var fL = bot;

    if (typeof replaceValue.value === 'object' && replaceValue.value.Class === 'Function') {
      rV = function() {
        var l = lub(searchValue.label, replaceValue.label);
        var _args = {};
        for (var i = 0 ; i < arguments.length; i++) {
          _args[i] = new Value(arguments[i],l);
        }
        _args.length = arguments.length;
        var res = replaceValue.Call(replaceValue,_args);
        fL = lub(fL,res.label);
        return res.value;
      };
    } else {
      replaceValue = conversion.ToString(replaceValue);
      rV = replaceValue.value;
    }

    var l   = lub(searchValue.label, replaceValue.label);
    var res = S.value.replace(sV,rV);

    return new Value(res, lub(l, fL));
  };

  // ------------------------------------------------------------
  // search, 15.5.4.12
  var search =  function(thisArg, args) {
    var regexp = args[0] || new Value(undefined,bot);

    conversion.CheckObjectCoercible(thisArg); 
    var string = conversion.ToString(thisArg);

    var rx = regexp;
    if (rx.value === null || typeof regexp.value !== 'object' || regexp.value.Class !== 'RegExp') {
      rx = monitor.instances.RegExpConstructor.Construct([regexp]); 
    }

    var lbl = lub(string.label, rx.value.PrimitiveLabel);
    monitor.assert(
      le(rx.label, rx.value.PrimitiveLabel),
      'String.prototype.match: label of regular expression object not below regular expression label'
    );

    rx.value.PrimitiveLabel = lbl;
    var result = string.value.search(rx.value.PrimitiveValue);
    
    return new Value(result, lbl);
  };

  // ------------------------------------------------------------
  // slice, 15.5.4.13
  var slice = function(thisArg,args) {
    var c = monitor.context;

    var start = args[0] || new Value(undefined,bot);
    var end = args[1] || new Value(undefined,bot);

    conversion.CheckObjectCoercible(thisArg); 
    var S = conversion.ToString(thisArg);
    var len = S.value.length;

    var intStart = conversion.ToInteger(start);

    c.pushPC(end.label);
      if (end.value === undefined) {
        end = new Value(len, lub(S.label, end.label));
      } else {
        end = conversion.ToInteger(end);
      }
    c.popPC();

    var str = S.value.slice(start.value, end.value);
    var lbl = lub(S.label,start.label,end.label);
    return new Value(str,lbl);
  };
    

  // ------------------------------------------------------------
  // split, 15.5.4.14
  var split = function(thisArg,args){
    var separator = args[0] || new Value(undefined,bot);
    var limit     = args[1] || new Value(undefined,bot);

    conversion.CheckObjectCoercible(thisArg); 
    var S = conversion.ToString(thisArg);
   
    var sep;
    var lbl = lub(S.label,separator.label);

    if (separator.value && typeof separator.value === 'object' && separator.value.Class === 'RegExp') {
      sep = separator.value.PrimitiveValue;

      monitor.assert(
        le(separator.label, separator.value.PrimitiveLabel),
        'String.prototype.split: label of regular expression object not below label of regular expression'
      );

      separator.value.PrimitiveLabel = lbl;
    } else {
      separator = conversion.ToString(separator);
      sep = separator.value;
      lbl.lub(separator.label);
    }

    lbl.lub(limit.label);
    var primitiveArray = S.value.split(sep, limit.value);
    var array = monitor.modules.array.ArrayObject.fromArray(primitiveArray,lbl,lbl);
    return new Value(array,bot);
  };

  // ------------------------------------------------------------
  // substring, 15.5.4.15
  var substring = function(thisArg,args){
    var start = args[0] || new Value(undefined,bot);
    var end   = args[1] || new Value(undefined,bot);

    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);

    start = conversion.ToInteger(start);

    var len = S.value.length;
  
    if (end.value === undefined) {
      end.value = len;
    } else {
      end = conversion.ToInteger(end);
    }

    var lbl = lub(S.label,start.label,end.label);
    var str = S.value.substring(start.value,end.value);
    return new Value(str,lbl);
  };

  // ------------------------------------------------------------
  var substr = function(thisArg,args){
    var start  = args[0] || new Value(undefined,0);
    var length = args[1] || new Value(undefined,0);

    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);

    start = conversion.ToInteger(start);
    if (length,value === undefined) {
      length.value = len;
    } else {
      length = conversion.ToInteger(length);
    }

    var lbl = lub(S.label,start.label,length.label);
    var str = S.value.substr(start.value,length.value);

    return new Value(str,lbl);
  };

  // ------------------------------------------------------------
  // toLowerCase, 15.5.4.16
  var toLowerCase = function(thisArg,args) {
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var L = S.value.toLowerCase();
    return new Value(L,S.label);
  };

  // ------------------------------------------------------------
  // toLocaleLowerCase, 15.5.4.17
  var toLocaleLowerCase = function(thisArg,args) {
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var L = S.value.toLocaleLowerCase();
    return new Value(L,S.label);
  };

  // ------------------------------------------------------------
  // toUpperCase, 15.5.4.18
  var toUpperCase = function(thisArg,args) {
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var L = S.value.toUpperCase();
    return new Value(L,S.label);
  };

  // ------------------------------------------------------------
  // toLocaleUpperCase, 15.5.4.19
  var toLocaleUpperCase = function(thisArg,args) {
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var L = S.value.toLocaleUpperCase();
    return new Value(L,S.label);
  };

  // ------------------------------------------------------------
  // trim, 15.5.4.20
  var trim = function(thisArg, args) {
    conversion.CheckObjectCoercible(thisArg);
    var S = conversion.ToString(thisArg);
    var T = S.value.trim();
    return new Value(T,S.label);
  };
    

  // ------------------------------------------------------------
  // String Object, 15.5.5

  function StringObject(val, lbl) {
    Ecma.call(this);

    this.Class          = 'String';
    this.PrimitiveValue = val;
    
    lbl = lbl || bot;
    this.PrimitiveLabel = lbl;

    this.properties     = new String(val);
    for (var i = 0, len = val.length; i < len; i++) {
      this.labels[i] = {
        value : lbl,
        existence : lbl
      };
    }

    this.labels.length = {
      value : lbl,
      existence : lbl
    };

    this.Extensible     = true;
    this.Prototype      = new Value(monitor.instances.StringPrototype,bot);

    // length is not modeled in this way, but by GetOwnProperty; however, e.g.,
    // delete will use the properties field for deletion. Thus, we add a fake model.
 //   ecma.DefineFFF(this, constants.length, 0);

  }
  
  prelude.inherits(StringObject,Ecma);

  // ---

  // TODO: we don't copy other properties on the Strings

  StringObject.prototype.toNative = function(deep) {
    var v = new String(this.properties);
    return new Value(v, this.PrimitiveLabel);
  };

  // ---

  return module;
};


},{}],47:[function(require,module,exports){
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

exports.functor = function(monitor){

  var label = monitor.require('label');

  var Label = label.Label;
  var lub   = label.lub;
  var le    = label.le;
  var bot   = Label.bot;

  // ------------------------------------------------------------

  var module = {};
  module.Value     = Value;
  module.Reference = Reference;

  // ------------------------------------------------------------
  // Value - labeled values

  function Value(v,l) {
      this.value = v;
      this.label = l || bot;
  }

  Value.prototype.equal = function(v) {
    if (! (v instanceof Value)) return false;
    if (this.value === undefined) return (v.value === undefined);
    if (this.value.equal)
      return (this.value.equal(v.value) && this.label.equal(v.label));
    else
      return (this.value == v.value && this.label.equal(v.label));
  };

  Value.prototype.raise = function(l) {
      this.label = lub(this.label,l);
  };

  Value.prototype.clone = function() {
    return new Value(this.value, this.label);
  };

  Value.prototype.toString = function() {
    if (typeof this.value === 'string') {
      return "'" + this.value + "'_" + this.label;
    } else {
      return this.value + "_" + this.label;
    }
  };

  // ------------------------------------------------------------

  function lift(name) {
    return function() {
      monitor.context.pushPC(this.label);
      var res = this.value[name].apply(this.value,arguments);
      monitor.context.popPC();
      if (res) {
        res.raise(this.label);
      }
      return res;
    };
  }

  // lift Ecma methods

  Value.prototype.Get                        = lift('Get');
  Value.prototype.GetProperty                = lift('GetProperty');
  Value.prototype.GetOwnProperty             = lift('GetOwnProperty');
  Value.prototype.DefineOwnProperty          = lift('DefineOwnProperty');
  Value.prototype.Put                        = lift('Put');
  Value.prototype.CanPut                     = lift('CanPut');
  Value.prototype.HasProperty                = lift('HasProperty');
  Value.prototype.Delete                     = lift('Delete');
  Value.prototype.DefaultValue               = lift('DefaultValue');

  Value.prototype.IsEnvironmentRecord        = lift('IsEnvironmentRecord');
  Value.prototype.HasBinding                 = lift('HasBinding');
  Value.prototype.GetBindingValue            = lift('GetBindingValue');
  Value.prototype.CreateMutableBinding       = lift('CreateMutableBinding');
  Value.prototype.SetMutableBinding          = lift('SetMutableBinding');
  Value.prototype.DeleteBinding              = lift('DeleteBinding');
  Value.prototype.ImplicitThisValue          = lift('ImplicitThisValue');
  Value.prototype.CreateImmutableBinding     = lift('CreateImmutableBinding');
  Value.prototype.InitializeImmutableBinding = lift('InitializeImmutableBinding');

  // lift Function methods

  Value.prototype.HasInstance = lift('HasInstance');
  Value.prototype.Call        = lift('Call');
  Value.prototype.Construct   = lift('Construct');

  // -------------------------------------------------------------

  function Reference(base,propertyName) {
      this.base = base;
      this.propertyName = propertyName;
  }

  Reference.prototype.GetBase = function() {
    return this.base;
  };

  Reference.prototype.GetReferencedName = function() {
    return this.propertyName;
  };

  Reference.prototype.HasPrimitiveBase = function() {
    var x = typeof this.base.value;

    return (x === 'boolean' || x === 'string' || x === 'number');
  };

  Reference.prototype.IsPropertyReference = function() {
    return (this.base.value.Class !== undefined || this.HasPrimitiveBase());
  };

  Reference.prototype.IsUnresolvableReference = function() {
    return (this.base.value === undefined);
  };

  Reference.prototype.toString = function() {
    return ('@(' + this.base + ',' + this.propertyName + ')'); 
  };

  return module;
};



},{}],48:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],49:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":50}],50:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],51:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],52:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":51,"_process":50,"inherits":48}]},{},[1]);

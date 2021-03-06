interface KeyValue extends Object {
	[k: string]: any;
}

interface EmailAddress {
	name: string;
	email: string;
}

/**
 * parse result
 */
interface ParsedEmlJson {
	headers: EmlHeaders;
	body?: string | (BoundaryConvertedData | null)[];
}

/**
 * read result
 */
interface ReadedEmlJson {
	date: Date | string;
	subject: string;
	from: EmailAddress | EmailAddress[] | null;
	to: EmailAddress | EmailAddress[] | null;
	cc?: EmailAddress | EmailAddress[] | null;
	headers: EmlHeaders;
	multipartAlternative?: {
		'Content-Type': string;
	};
	text?: string;
	textheaders?: BoundaryHeaders;
	html?: string;
	htmlheaders?: BoundaryHeaders;
	attachments?: Attachment[];
	// data not be build
	// if have EMl can find `data`, maybe I will know how to do
	data?: string;
}

/**
 * Attachment file
 */
interface Attachment {
	name: string;
	contentType: string;
	inline: boolean;
	data: string | Uint8Array;
	filename?: string;
	mimeType?: string;
	id?: string;
	cid?: string;
}

/**
 * EML headers
 * @description `MIME-Version`, `Accept-Language`, `Content-Language` and `Content-Type` shuld Must exist when to build a EML file
 */
interface EmlHeaders extends KeyValue {
	Date?: string;
	Subject?: string;
	From?: string;
	To?: string;
	Cc?: string;
	CC?: string;
	'Content-Disposition'?: string | null;
	'Content-Type'?: string | null;
	'Content-Transfer-Encoding'?: string;
	'MIME-Version'?: string;
	'Content-ID'?: string;
	//  zh-CN, en-US
	'Accept-Language'?: string;
	// zh-CN
	'Content-Language'?: string;
	// Why not all ?
	// OutLook is follows
	'Content-type'?: string | null;
	'Content-transfer-encoding'?: string;
}

interface Options {
	headersOnly: boolean;
}
/**
 * encode is not realized yet
 */
interface BuildOptions extends Options {
	encode?: boolean; // Not realized yet
}

type CallbackFn<T> = (error: any, result?: T) => void;

type OptionOrNull = Options | null;

/**
 * BoundaryRawData
 */
interface BoundaryRawData {
	boundary: string;
	lines: string[];
}
/**
 * Convert BoundaryRawData result
 */
interface BoundaryConvertedData {
	boundary: string;
	part: {
		headers: BoundaryHeaders;
		body: string | Array<BoundaryConvertedData | string>;
	};
}
interface BoundaryHeaders extends KeyValue {
	'Content-Type': string;
	'Content-Transfer-Encoding'?: string;
	'Content-Disposition'?: string;
}

/**
 * @author superchow
 * @emil superchow@live.cn
 */

import { Base64 } from 'js-base64';
import { getCharsetName, guid, wrap, mimeDecode, GB2312UTF8 } from './utils';
import { encode, decode, convert } from './charset';

/**
 * log for test
 */
let verbose: boolean = false;
const defaultCharset = 'utf-8';
const fileExtensions: KeyValue = {
	'text/plain': '.txt',
	'text/html': '.html',
	'image/png': '.png',
	'image/jpg': '.jpg',
	'image/jpeg': '.jpg',
};

/**
 * Gets file extension by mime type
 * @param {String} mimeType
 * @returns {String}
 */
// eslint-disable-next-line no-unused-vars
function getFileExtension(mimeType: string): string {
	return fileExtensions[mimeType] || '';
}

/**
 * create a boundary
 */
function createBoundary(): string {
	return '----=' + guid();
}
/**
 * Builds e-mail address string, e.g. { name: 'PayPal', email: 'noreply@paypal.com' } => 'PayPal' <noreply@paypal.com>
 * @param {String|EmailAddress|EmailAddress[]|null} data
 */
function toEmailAddress(data?: string | EmailAddress | EmailAddress[] | null): string {
	let email = '';
	if (typeof data === 'undefined') {
		//No e-mail address
	} else if (typeof data === 'string') {
		email = data;
	} else if (typeof data === 'object') {
		if (Array.isArray(data)) {
			email += data
				.map(item => {
					let str = '';
					if (item.name) {
						str += '"' + item.name.replace(/^"|"\s*$/g, '') + '" ';
					}
					if (item.email) {
						str += '<' + item.email + '>';
					}
					return str;
				})
				.filter(a => a)
				.join(', ');
		} else {
			if (data) {
				if (data.name) {
					email += '"' + data.name.replace(/^"|"\s*$/g, '') + '" ';
				}
				if (data.email) {
					email += '<' + data.email + '>';
				}
			}
		}
	}
	return email;
}

/**
 * Gets the boundary name
 * @param {String} contentType
 * @returns {String|undefined}
 */
function getBoundary(contentType: string) {
	const match = /boundary="?(.+?)"?(\s*;[\s\S]*)?$/g.exec(contentType);
	return match ? match[1] : undefined;
}

/**
 * Gets character set name, e.g. contentType='.....charset='iso-8859-2'....'
 * @param {String} contentType
 * @returns {String|undefined}
 */
function getCharset(contentType: string) {
	const match = /charset\s*=\W*([\w\-]+)/g.exec(contentType);
	return match ? match[1] : undefined;
}

/**
 * Gets name and e-mail address from a string, e.g. 'PayPal' <noreply@paypal.com> => { name: 'PayPal', email: 'noreply@paypal.com' }
 * @param {String} raw
 * @returns { EmailAddress | EmailAddress[] | null}
 */
function getEmailAddress(raw: string): EmailAddress | EmailAddress[] | null {
	const list: EmailAddress[] = [];

	//Split around ',' char
	//const parts = raw.split(/,/g); //Will also split ',' inside the quotes
	//const parts = raw.match(/('.*?'|[^',\s]+)(?=\s*,|\s*$)/g); //Ignore ',' within the double quotes
	const parts = raw.match(/('[^']*')|[^,]+/g); //Ignore ',' within the double quotes
	// parts === null
	if (!parts) {
		return list;
	}

	for (let i = 0; i < parts.length; i++) {
		const address: EmailAddress = {
			name: '',
			email: '',
		};
		const partsStr = unquoteString(parts[i]);
		//Quoted name but without the e-mail address
		if (/^'.*'$/g.test(partsStr)) {
			address.name = partsStr.replace(/'/g, '').trim();
			i++; //Shift to another part to capture e-mail address
		}

		const regex = /^(.*?)(\s*\<(.*?)\>)$/g;
		const match = regex.exec(partsStr);
		if (match) {
			const name = match[1].replace(/'/g, '').trim();
			if (name && name.length) {
				address.name = name;
			}
			address.email = match[3].trim();
			list.push(address);
		} else {
			//E-mail address only (without the name)
			address.email = partsStr.trim();
			list.push(address);
		}
	}

	//Return result
	if (list.length === 0) {
		return null; //No e-mail address
	}
	if (list.length === 1) {
		return list[0]; //Only one record, return as object, required to preserve backward compatibility
	}
	return list; //Multiple e-mail addresses as array
}

/**
 * decode one joint
 * @param {String} str
 * @returns {String}
 */
function decodeJoint(str: string) {
	const match = /=\?([^?]+)\?(B|Q)\?(.+?)(\?=)/gi.exec(str);
	if (match) {
		const charset = getCharsetName(match[1] || defaultCharset); //eq. match[1] = 'iso-8859-2'; charset = 'iso88592'
		const type = match[2].toUpperCase();
		const value = match[3];
		if (type === 'B') {
			//Base64
			if (charset === 'utf8') {
				return decode(encode(Base64.fromBase64(value.replace(/\r?\n/g, ''))), 'utf8');
			} else {
				return decode(encode(Base64.fromBase64(value.replace(/\r?\n/g, ''))), charset);
			}
		} else if (type === 'Q') {
			//Quoted printable
			return unquotePrintable(value, charset);
		}
	}
	return str;
}

/**
 * decode section
 * @param {String} str
 * @returns {String}
 */
function unquoteString(str: string): string {
	const regex = /=\?([^?]+)\?(B|Q)\?(.+?)(\?=)/gi;
	let decodedString = str || '';
	const spinOffMatch = decodedString.match(regex);
	if (spinOffMatch) {
		spinOffMatch.forEach(spin => {
			decodedString = decodedString.replace(spin, decodeJoint(spin));
		});
	}

	return decodedString.replace(/\r?\n/g, '');
}
/**
 * Decodes 'quoted-printable'
 * @param {String} value
 * @param {String} charset
 * @returns {String}
 */
function unquotePrintable(value: string, charset?: string): string {
	//Convert =0D to '\r', =20 to ' ', etc.
	// if (!charset || charset == "utf8" || charset == "utf-8") {
	//   return value
	//     .replace(/=([\w\d]{2})=([\w\d]{2})=([\w\d]{2})/gi, function (matcher, p1, p2, p3, offset, string) {

	//     })
	//     .replace(/=([\w\d]{2})=([\w\d]{2})/gi, function (matcher, p1, p2, offset, string) {

	//     })
	//     .replace(/=([\w\d]{2})/gi, function (matcher, p1, offset, string) { return String.fromCharCode(parseInt(p1, 16)); })
	//     .replace(/=\r?\n/gi, ""); //Join line
	// } else {
	//   return value
	//     .replace(/=([\w\d]{2})=([\w\d]{2})/gi, function (matcher, p1, p2, offset, string) {

	//     })
	//     .replace(/=([\w\d]{2})/gi, function (matcher, p1, offset, string) {

	//      })
	//     .replace(/=\r?\n/gi, ''); //Join line
	// }
	const rawString = value
		.replace(/[\t ]+$/gm, '') // remove invalid whitespace from the end of lines
		.replace(/=(?:\r?\n|$)/g, ''); // remove soft line breaks

	return mimeDecode(rawString, charset);
}

/**
 * Parses EML file content and returns object-oriented representation of the content.
 * @param {String} eml
 * @param {OptionOrNull | CallbackFn<ParsedEmlJson>} options
 * @param {CallbackFn<ParsedEmlJson>} callback
 * @returns {string | Error | ParsedEmlJson}
 */
function parse(
	eml: string,
	options?: OptionOrNull | CallbackFn<ParsedEmlJson>,
	callback?: CallbackFn<ParsedEmlJson>
): string | Error | ParsedEmlJson {
	//Shift arguments
	if (typeof options === 'function' && typeof callback === 'undefined') {
		callback = options;
		options = null;
	}
	if (typeof options !== 'object') {
		options = { headersOnly: false };
	}
	let error: string | Error | undefined;
	let result: ParsedEmlJson | undefined;
	try {
		if (typeof eml !== 'string') {
			throw new Error('Argument "eml" expected to be string!');
		}

		const lines = eml.split(/\r?\n/);
		result = parseRecursive(lines, 0, options as Options) as ParsedEmlJson;
	} catch (e) {
		error = e;
	}
	callback && callback(error, result);
	return error || result || new Error('read EML failed!');
}

/**
 * Parses EML file content.
 * @param {String[]} lines
 * @param {Number}   start
 * @param {Options}  options
 * @returns {ParsedEmlJson}
 */
function parseRecursive(lines: string[], start: number, options: Options) {
	const result: {
		headers: EmlHeaders;
		body?: string | BoundaryRawData[] | Array<BoundaryConvertedData | null>;
	} = {
		headers: {},
	};
	let boundary: BoundaryRawData = {
		boundary: '',
		lines: [],
	};
	let lastHeaderName = '';
	let findBoundary = '';
	let insideBody = false;
	let insideBoundary = false;
	let isMultiHeader = false;
	let isMultipart = false;
	let isSpecification = false;

	//result.body = null;

	//Read line by line
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];

		//Header
		if (!insideBody) {
			//Search for empty line
			if (line === '') {
				/**
				 * OutLook
				 * skip specification like > This message ····
				 * > This message is in MIME format. Since your mail reader does not understand
						this format, some or all of this message may not be legible.
				 * find in OutLook email 
				 */
				const nextLine = lines[i + 1];
				if (nextLine.indexOf('>') === 0) {
					isSpecification = true;
					continue;
				} else {
					isSpecification = false;
				}
				insideBody = true;

				if (options && options.headersOnly) {
					break;
				}

				//Expected boundary
				const ct = result.headers['Content-Type'] || result.headers['Content-type'];
				if (verbose) {
					console.info(`line 418 ct: ${ct}`);
				}
				if (ct && /^multipart\//g.test(ct)) {
					const b = getBoundary(ct);
					if (b && b.length) {
						findBoundary = b;
						isMultipart = true;
						result.body = [];
						if (verbose) {
							console.info('line 427 Multipart with boundary! ' + b);
						}
					} else {
						if (verbose) {
							console.warn('line 431 Multipart without boundary! ' + ct.replace(/\r?\n/g, ' '));
						}
					}
				}

				continue;
			}
			if (isSpecification) {
				continue;
			}

			//Header name and value
			const match = /^([\w\d\-]+):\s*([^\r\n]+|)/gi.exec(line);
			if (match) {
				lastHeaderName = match[1];
				if (result.headers[lastHeaderName]) {
					//Multiple headers with the same name
					isMultiHeader = true;
					if (typeof result.headers[lastHeaderName] === 'string') {
						result.headers[lastHeaderName] = [result.headers[lastHeaderName]];
					}
					result.headers[lastHeaderName].push(match[2]);
				} else {
					//Header first appeared here
					isMultiHeader = false;
					result.headers[lastHeaderName] = match[2];
				}
				continue;
			}

			//Header value with new line
			const lineMatch = /^\s+([^\r\n]+)/g.exec(line);
			if (lineMatch) {
				if (isMultiHeader) {
					result.headers[lastHeaderName][result.headers[lastHeaderName].length - 1] += '\r\n' + lineMatch[1];
				} else {
					result.headers[lastHeaderName] += '\r\n' + lineMatch[1];
				}
				continue;
			}
		} else {
			//Body
			//Multipart body
			if (isMultipart && Array.isArray(result.body)) {
				//Search for boundary start

				//Updated on 2019-10-12: A line before the boundary marker is not required to be an empty line
				//if (lines[i - 1] === "" && line.indexOf("--" + findBoundary) === 0 && !/\-\-(\r?\n)?$/g.test(line)) {
				if (line.indexOf('--' + findBoundary) === 0 && !/\-\-(\r?\n)?$/g.test(line)) {
					insideBoundary = true;

					//Complete the previous boundary
					// if (boundary && boundary.lines) {
					//   (result.body as BoundaryRawData[]).push(boundary);
					// }

					//Start a new boundary
					const match = /^\-\-([^\r\n]+)(\r?\n)?$/g.exec(line);
					boundary = { boundary: match ? match[1] : '', lines: [] };
					(result.body as BoundaryRawData[]).push(boundary);
					if (verbose) {
						console.log('line 493 Found boundary: ' + boundary.boundary);
					}

					continue;
				}

				if (insideBoundary && boundary) {
					//Search for boundary end
					if (boundary.boundary && lines[i + 1] === '' && line.indexOf('--' + findBoundary + '--') === 0) {
						if (verbose) {
							console.log(`line 503: lines[i - 1] === ${lines[i - 1]} and lines[i + 1] === ${lines[i + 1]}`);
						}
						insideBoundary = false;
						result.body = (result.body as any[]).map(boundaryRawData => completeBoundary(boundaryRawData)).filter(a => a);
						continue;
					}
					boundary.lines.push(line);
				}
			} else {
				//Solid string body
				result.body = lines.splice(i).join('\r\n');
				break;
			}
		}
	}

	return result;
}

/**
 * Convert BoundaryRawData to BoundaryConvertedData
 * @param {BoundaryRawData} boundary
 * @returns {BoundaryConvertedData} Obj
 */
function completeBoundary(boundary: BoundaryRawData): BoundaryConvertedData | null {
	if (!boundary || !boundary.boundary) {
		return null;
	}
	const lines = boundary.lines || [];
	const result = {
		boundary: boundary.boundary,
		part: {
			headers: {},
		},
	} as BoundaryConvertedData;
	let lastHeaderName = '';
	let insideBody = false;
	let childBoundary: BoundaryRawData | undefined;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!insideBody) {
			if (line === '') {
				insideBody = true;
				continue;
			}
			//Header name and value /^([\w\d\-]+):\s*([^\r\n]+|)/
			const match = /^([\w\d\-]+):\s*([^\r\n]+|)/gi.exec(line);
			if (match) {
				lastHeaderName = match[1];
				result.part.headers[lastHeaderName] = match[2];
				continue;
			}
			//Header value with new line
			const lineMatch = /^\s+([^\r\n]+)/g.exec(line);
			if (lineMatch) {
				result.part.headers[lastHeaderName] += '\r\n' + lineMatch[1];
				continue;
			}
		} else {
			// part.body
			const match = /^\-\-([^\r\n]+)(\r?\n)?$/g.exec(line);
			const childBoundaryStr = getBoundary(result.part.headers['Content-Type'] || result.part.headers['Content-type']);
			if (verbose) {
				if (match) {
					console.log(`line 568: line is ${line}, ${'--' + childBoundaryStr}`, `${line.indexOf('--' + childBoundaryStr)}`);
				}
			}
			if (match && line.indexOf('--' + childBoundaryStr) === 0 && !childBoundary) {
				childBoundary = { boundary: match ? match[1] : '', lines: [] };
				continue;
			} else if (!!childBoundary && childBoundary.boundary) {
				if (lines[index - 1] === '' && line.indexOf('--' + childBoundary.boundary) === 0) {
					const child = completeBoundary(childBoundary);
					if (verbose) {
						console.info(`578: ${JSON.stringify(child)}`);
					}
					if (child) {
						if (Array.isArray(result.part.body)) {
							result.part.body.push(child);
						} else {
							result.part.body = [child];
						}
					} else {
						result.part.body = childBoundary.lines.join('\r\n');
					}
					// next line child
					if (!!lines[index + 1]) {
						childBoundary.lines = [];
						continue;
					}
					// end line child And this boundary's end
					if (line.indexOf('--' + childBoundary.boundary + '--') === 0 && lines[index + 1] === '') {
						if (verbose) {
							console.info('line 601 childBoundary is over line is 534');
						}
						childBoundary = undefined;
						break;
					}
				}
				childBoundary.lines.push(line);
			} else {
				if (verbose) {
					console.warn('body is string');
				}
				result.part.body = lines.splice(index).join('\r\n');
				break;
			}
		}
	}
	return result;
}

/**
 * buid EML file by ReadedEmlJson or EML file content
 * @param {ReadedEmlJson} data
 * @param {BuildOptions | CallbackFn<string> | null} options
 * @param {CallbackFn<string>} callback
 */
function build(
	data: ReadedEmlJson | string,
	options?: BuildOptions | CallbackFn<string> | null,
	callback?: CallbackFn<string>
): string | Error {
	//Shift arguments
	if (typeof options === 'function' && typeof callback === 'undefined') {
		callback = options;
		options = null;
	}
	let error: Error | string | undefined;
	let eml = '';
	const EOL = '\r\n'; //End-of-line

	try {
		if (!data) {
			throw new Error('Argument "data" expected to be an object! or string');
		}
		if (typeof data === 'string') {
			const readResult = read(data);
			if (typeof readResult === 'string') {
				throw new Error(readResult);
			} else if (readResult instanceof Error) {
				throw readResult;
			} else {
				data = readResult;
			}
		}

		if (!data.headers) {
			throw new Error('Argument "data" expected to be has headers');
		}

		if (typeof data.subject === 'string') {
			data.headers['Subject'] = data.subject;
		}

		if (typeof data.from !== 'undefined') {
			data.headers['From'] = toEmailAddress(data.from);
		}

		if (typeof data.to !== 'undefined') {
			data.headers['To'] = toEmailAddress(data.to);
		}

		if (typeof data.cc !== 'undefined') {
			data.headers['Cc'] = toEmailAddress(data.cc);
		}

		// if (!data.headers['To']) {
		//   throw new Error('Missing "To" e-mail address!');
		// }

		const emlBoundary = getBoundary(data.headers['Content-Type'] || data.headers['Content-type'] || '');
		let hasBoundary = false;
		let boundary = createBoundary();
		let multipartBoundary = '';
		if (data.multipartAlternative) {
			multipartBoundary = '' + (getBoundary(data.multipartAlternative['Content-Type']) || '');
			hasBoundary = true;
		}
		if (emlBoundary) {
			boundary = emlBoundary;
			hasBoundary = true;
		} else {
			data.headers['Content-Type'] = data.headers['Content-type'] || 'multipart/mixed;' + EOL + 'boundary="' + boundary + '"';
			// Restrained
			// hasBoundary = true;
		}

		//Build headers
		const keys = Object.keys(data.headers);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const value: string | string[] = data.headers[key];
			if (typeof value === 'undefined') {
				continue; //Skip missing headers
			} else if (typeof value === 'string') {
				eml += key + ': ' + value.replace(/\r?\n/g, EOL + '  ') + EOL;
			} else {
				//Array
				for (let j = 0; j < value.length; j++) {
					eml += key + ': ' + value[j].replace(/\r?\n/g, EOL + '  ') + EOL;
				}
			}
		}

		if (data.multipartAlternative) {
			eml += EOL;
			eml += '--' + emlBoundary + EOL;
			eml += 'Content-Type: ' + data.multipartAlternative['Content-Type'].replace(/\r?\n/g, EOL + '  ') + EOL;
		}

		//Start the body
		eml += EOL;

		//Plain text content
		if (data.text) {
			// Encode opened and self headers keeped
			if (typeof options === 'object' && !!options && options.encode && data.textheaders) {
				eml += '--' + boundary + EOL;
				for (const key in data.textheaders) {
					if (data.textheaders.hasOwnProperty(key)) {
						eml += `${key}: ${data.textheaders[key].replace(/\r?\n/g, EOL + '  ')}`;
					}
				}
			} else if (hasBoundary) {
				// else Assembly
				eml += '--' + (multipartBoundary ? multipartBoundary : boundary) + EOL;
				eml += 'Content-Type: text/plain; charset="utf-8"' + EOL;
			}
			eml += EOL + data.text;
			eml += EOL;
		}

		//HTML content
		if (data.html) {
			// Encode opened and self headers keeped
			if (typeof options === 'object' && !!options && options.encode && data.textheaders) {
				eml += '--' + boundary + EOL;
				for (const key in data.textheaders) {
					if (data.textheaders.hasOwnProperty(key)) {
						eml += `${key}: ${data.textheaders[key].replace(/\r?\n/g, EOL + '  ')}`;
					}
				}
			} else if (hasBoundary) {
				eml += '--' + (multipartBoundary ? multipartBoundary : boundary) + EOL;
				eml += 'Content-Type: text/html; charset="utf-8"' + EOL;
			}
			if (verbose) {
				console.info(
					`line 765 ${hasBoundary}, emlBoundary: ${emlBoundary}, multipartBoundary: ${multipartBoundary}, boundary: ${boundary}`
				);
			}
			eml += EOL + data.html;
			eml += EOL;
		}

		//Append attachments
		if (data.attachments) {
			for (let i = 0; i < data.attachments.length; i++) {
				const attachment = data.attachments[i];
				eml += '--' + boundary + EOL;
				eml += 'Content-Type: ' + (attachment.contentType.replace(/\r?\n/g, EOL + '  ') || 'application/octet-stream') + EOL;
				eml += 'Content-Transfer-Encoding: base64' + EOL;
				eml +=
					'Content-Disposition: ' +
					(attachment.inline ? 'inline' : 'attachment') +
					'; filename="' +
					(attachment.filename || attachment.name || 'attachment_' + (i + 1)) +
					'"' +
					EOL;
				if (attachment.cid) {
					eml += 'Content-ID: <' + attachment.cid + '>' + EOL;
				}
				eml += EOL;
				if (typeof attachment.data === 'string') {
					const content = Base64.toBase64(attachment.data);
					eml += wrap(content, 72) + EOL;
				} else {
					//Buffer
					// Uint8Array to string by new TextEncoder
					const content = decode(attachment.data);
					eml += wrap(content, 72) + EOL;
				}
				eml += EOL;
			}
		}

		//Finish the boundary
		if (hasBoundary) {
			eml += '--' + boundary + '--' + EOL;
		}
	} catch (e) {
		error = e;
	}
	callback && callback(error, eml);
	return error || eml;
}

/**
 * Parses EML file content and return user-friendly object.
 * @param {String | ParsedEmlJson} eml EML file content or object from 'parse'
 * @param { OptionOrNull | CallbackFn<ReadedEmlJson>} options EML parse options
 * @param {CallbackFn<ReadedEmlJson>} callback Callback function(error, data)
 */
function read(
	eml: string | ParsedEmlJson,
	options?: OptionOrNull | CallbackFn<ReadedEmlJson>,
	callback?: CallbackFn<ReadedEmlJson>
): ReadedEmlJson | Error | string {
	//Shift arguments
	if (typeof options === 'function' && typeof callback === 'undefined') {
		callback = options;
		options = null;
	}
	let error: Error | string | undefined;
	let result: ReadedEmlJson | undefined;

	//Appends the boundary to the result
	function _append(headers: EmlHeaders, content: string | Uint8Array | Attachment, result: ReadedEmlJson) {
		const contentType = headers['Content-Type'] || headers['Content-type'];
		const charset = getCharsetName(getCharset(contentType as string) || defaultCharset);
		let encoding = headers['Content-Transfer-Encoding'] || headers['Content-transfer-encoding'];
		if (typeof encoding === 'string') {
			encoding = encoding.toLowerCase();
		}
		if (encoding === 'base64') {
			if (contentType && contentType.indexOf('gbk') >= 0) {
				// is work?  I'm not sure
				content = encode(GB2312UTF8.GB2312ToUTF8((content as string).replace(/\r?\n/g, '')));
			} else {
				// string to Uint8Array by TextEncoder
				content = encode((content as string).replace(/\r?\n/g, ''));
			}
		} else if (encoding === 'quoted-printable') {
			content = unquotePrintable(content as string, charset);
		} else if (encoding && charset !== 'utf8' && encoding.search(/binary|8bit/) === 0) {
			//'8bit', 'binary', '8bitmime', 'binarymime'
			content = decode(content as Uint8Array, charset);
		}

		if (!result.html && contentType && contentType.indexOf('text/html') >= 0) {
			if (typeof content !== 'string') {
				content = decode(content as Uint8Array, charset);
			}
			//Message in HTML format
			result.html = content;
			result.htmlheaders = {
				'Content-Type': contentType,
				'Content-Transfer-Encoding': encoding || '',
			};
			// self boundary Not used at conversion
		} else if (!result.text && contentType && contentType.indexOf('text/plain') >= 0) {
			if (typeof content !== 'string') {
				content = decode(content as Uint8Array, charset);
			}
			//Plain text message
			result.text = content;
			result.textheaders = {
				'Content-Type': contentType,
				'Content-Transfer-Encoding': encoding || '',
			};
			// self boundary Not used at conversion
		} else {
			//Get the attachment
			if (!result.attachments) {
				result.attachments = [];
			}

			const attachment = {} as Attachment;

			const id = headers['Content-ID'];
			if (id) {
				attachment.id = id;
			}

			let name = headers['Content-Disposition'] || headers['Content-Type'] || headers['Content-type'];
			if (name) {
				const match = /name="?(.+?)"?$/gi.exec(name);
				if (match) {
					name = match[1];
				} else {
					name = null;
				}
			}
			if (name) {
				attachment.name = name;
			}

			const ct = headers['Content-Type'] || headers['Content-type'];
			if (ct) {
				attachment.contentType = ct;
			}

			const cd = headers['Content-Disposition'];
			if (cd) {
				attachment.inline = /^\s*inline/g.test(cd);
			}

			attachment.data = content as Uint8Array;
			result.attachments.push(attachment);
		}
	}

	function _read(data: ParsedEmlJson): ReadedEmlJson | Error | string {
		if (!data) {
			return 'no data';
		}
		try {
			const result = {} as ReadedEmlJson;
			if (!data.headers) {
				throw new Error('data does\'t has headers');
			}
			if (data.headers['Date']) {
				result.date = new Date(data.headers['Date']);
			}
			if (data.headers['Subject']) {
				result.subject = unquoteString(data.headers['Subject']);
			}
			if (data.headers['From']) {
				result.from = getEmailAddress(data.headers['From']);
			}
			if (data.headers['To']) {
				result.to = getEmailAddress(data.headers['To']);
			}
			if (data.headers['CC']) {
				result.cc = getEmailAddress(data.headers['CC']);
			}
			if (data.headers['Cc']) {
				result.cc = getEmailAddress(data.headers['Cc']);
			}
			result.headers = data.headers;

			//Content mime type
			let boundary = null;
			const ct = data.headers['Content-Type'] || data.headers['Content-type'];
			if (ct && /^multipart\//g.test(ct)) {
				const b = getBoundary(ct);
				if (b && b.length) {
					boundary = b;
				}
			}

			if (boundary && Array.isArray(data.body)) {
				for (let i = 0; i < data.body.length; i++) {
					const boundaryBlock = data.body[i];
					if (!boundaryBlock) {
						continue;
					}
					//Get the message content
					if (typeof boundaryBlock.part === 'undefined') {
						verbose && console.warn('Warning: undefined b.part');
					} else if (typeof boundaryBlock.part === 'string') {
						result.data = boundaryBlock.part;
					} else {
						if (typeof boundaryBlock.part.body === 'undefined') {
							verbose && console.warn('Warning: undefined b.part.body');
						} else if (typeof boundaryBlock.part.body === 'string') {
							_append(boundaryBlock.part.headers, boundaryBlock.part.body, result);
						} else {
							// keep multipart/alternative
							const currentHeaders = boundaryBlock.part.headers;
							const currentHeadersContentType = currentHeaders['Content-Type'] || currentHeaders['Content-type'];
							if (verbose) {
								console.log(`line 969 currentHeadersContentType: ${currentHeadersContentType}`);
							}
							// Hasmore ?
							if (currentHeadersContentType && currentHeadersContentType.indexOf('multipart') >= 0 && !result.multipartAlternative) {
								result.multipartAlternative = {
									'Content-Type': currentHeadersContentType,
								};
							}
							for (let j = 0; j < boundaryBlock.part.body.length; j++) {
								const selfBoundary = boundaryBlock.part.body[j];
								if (typeof selfBoundary === 'string') {
									result.data = selfBoundary;
									continue;
								}

								const headers = selfBoundary.part.headers;
								const content = selfBoundary.part.body;

								_append(headers, content as string, result);
							}
						}
					}
				}
			} else if (typeof data.body === 'string') {
				_append(data.headers, data.body, result);
			}
			return result;
		} catch (e) {
			return e;
		}
	}

	if (typeof eml === 'string') {
		const parseResult = parse(eml, options as OptionOrNull);
		if (typeof parseResult === 'string' || parseResult instanceof Error) {
			error = parseResult;
		} else {
			const readResult = _read(parseResult);
			if (typeof readResult === 'string' || readResult instanceof Error) {
				error = readResult;
			} else {
				result = readResult;
			}
		}
	} else if (typeof eml === 'object') {
		const readResult = _read(eml);
		if (typeof readResult === 'string' || readResult instanceof Error) {
			error = readResult;
		} else {
			result = readResult;
		}
	} else {
		error = new Error('Missing EML file content!');
	}
	callback && callback(error, result);
	return error || result || new Error('read EML failed!');
}

/**
 * if you need
 * eml-format all api
 */
export {
	getEmailAddress,
	toEmailAddress,
	createBoundary,
	getBoundary,
	getCharset,
	unquoteString,
	unquotePrintable,
	mimeDecode,
	Base64,
	convert,
	encode,
	decode,
	completeBoundary,
	parse as parseEml,
	read as readEml,
	build as buildEml,
	GB2312UTF8 as GBKUTF8,
};

//  const GBKUTF8 = GB2312UTF8;

//  const parseEml = parse;
//  const readEml = read;
//  const buildEml = build;

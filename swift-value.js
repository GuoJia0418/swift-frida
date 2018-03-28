const types = require('./types');

let selfPointers = new Map();
// We need to hook this function at startup, because hooking it seems to happen asynchronously
// (maybe because this is basically self-modifying code?) and we don't want to run into race-conditions.
let toCStringPtr = Module.findExportByName("libswiftFoundation.dylib", "_T0s14StringProtocolP10FoundationsAARzSS5IndexVADRtzlE01cA0Says4Int8VGSgSSACE8EncodingV5using_tF");
Interceptor.attach(toCStringPtr, {
    onEnter: function() {
        if (selfPointers.has(this.threadId)) {
            let selfRegister = Process.pointerSize === 8 ? "x20" : "r10";
            this.context[selfRegister] = selfPointers.get(this.threadId);
            console.log(`${this.context[selfRegister]}`);
            selfPointers.delete(this.threadId)
        }
    },
});

function swiftToString(obj) {
    let type = obj.$type;
    let pointer = obj.$pointer;
    /*
     * built by disassembling the code for this snippet:
     *
        var str = String()
        dump(x, to: &str)
        let arr : [CChar] = str.cString(using: String.Encoding.utf8)!
        let ptr = UnsafePointer<CChar>(arr)
        strlen(ptr)
     */
    function __swift_destroy_boxed_opaque_existential_0(pointer) {
        let opaque = new types.OpaqueExistentialContainer(pointer);
        let type = opaque.type;
        let vwt = opaque.type.valueWitnessTable;
        if (vwt.flags.IsNonInline) {
            let _swift_release_ = new NativeFunction(Memory.readPointer(Swift._api._swift_release), 'void', ['pointer']);
            _swift_release_(opaque.fixedSizeBuffer[0]);
        } else {
            let destroy = vwt.destroy;
            destroy(pointer, type._ptr);
        }
    }

    let SwiftString = Swift._typesByName.get("Swift.String");
    if (!SwiftString.canonicalType)
        SwiftString = SwiftString.withGenericParams();

    let dynamicType;

    let copy = Memory.alloc(4 * Process.pointerSize);
    let copyFn;
    if (type.kind === "Existential" && type.getRepresentation() === "Opaque") {
        dynamicType = Swift._api.swift_getDynamicType(pointer, type.canonicalType._ptr, 1);
        copyFn = type.canonicalType.valueWitnessTable.initializeBufferWithCopyOfBuffer;
    } else {
        dynamicType = "$isaClass" in obj ? obj.$isaClass : type.canonicalType._ptr;
        copyFn = type.canonicalType.valueWitnessTable.initializeBufferWithCopy;
    }
    copyFn(copy, pointer, dynamicType);
    Memory.writePointer(copy.add(3 * Process.pointerSize), dynamicType);

    let stringResult = Memory.alloc(Process.pointerSize * 3);
    Memory.writePointer(stringResult, Swift._api._T0s19_emptyStringStorages6UInt32Vv);
    Memory.writePointer(stringResult.add(Process.pointerSize), ptr(0));
    Memory.writePointer(stringResult.add(2*Process.pointerSize), ptr(0));


    let textOutputStreamWitnessTableForString = Swift._api._T0SSs16TextOutputStreamsWP;
    let Any = Swift._api.swift_getExistentialTypeMetadata(1, ptr(0), 0, ptr(0));

    let dump = Swift._api._T0s4dumpxx_q_z2toSSSg4nameSi6indentSi8maxDepthSi0E5Itemsts16TextOutputStreamR_r0_lF;

    const LONG_MAX = Process.pointerSize == 4 ? ((1 << 31) - 1) : int64("0x1").shl(63).sub(1);
    // TODO: default arguments should in theory be retrieved via generator functions
    // 32bit: copy is passed directly on the stack, and we must use something like `initializeBufferWithCopyOfBuffer`
    // to copy it there. 

    let res = dump(/*value*/ copy, // passed as pointer
        /*to*/ stringResult, // empty String
        /*name*/ ptr(0), ptr(0), ptr(0), 1, // nil
        /*indent*/ ptr(0),
        /*maxDepth*/ LONG_MAX,
        /*maxItems*/ LONG_MAX,
        /*static type of `value`*/ Any,
        /*static type of `to`*/ SwiftString.canonicalType._ptr,
        /*how to use `to` as a TextOutputStream*/ textOutputStreamWitnessTableForString);

    // We really should be calling ___swift_destroy_boxed_opaque_existential_0  on res
    // but Frida already has deconstructed it into a struct for us.
    // But we know that `dump` just returns a pointer to the container the `copy` parameter points to --
    // so let's just destroy that.
    /*let copyOfCopy = Memory.alloc(Process.pointerSize * 4);
    Memory.copy(copyOfCopy, copy, Process.pointerSize * 4);
    __swift_destroy_boxed_opaque_existential_0(copyOfCopy);*/
    console.log(Memory.readPointer(stringResult));
    console.log(Memory.readPointer(stringResult.add(4)));
    console.log(Memory.readPointer(stringResult.add(8)));

    let encoding = Memory.readPointer(Swift._api._T0SS10FoundationE8EncodingV4utf8ACfau());

    let witnessTableStringProtocol = Swift._api._T0SSs14StringProtocolsWP;
    let listener;
    let threadId = Process.getCurrentThreadId();
    let toCString = new NativeFunction(toCStringPtr, 'pointer', ['pointer', 'pointer', 'pointer']);
    selfPointers.set(threadId, stringResult);
    let array = toCString(encoding, SwiftString.canonicalType._ptr, witnessTableStringProtocol);

    // the `BridgeObject` this `[CChar]?` contains somewhere deep down is Opaque, so we can't use type
    // metadata to find this offset
    let str = Memory.readUtf8String(array.add(8 + 3 * Process.pointerSize));

    Swift._api.swift_unknownRelease(Memory.readPointer(stringResult.add(2*Process.pointerSize)));
    Swift._api.swift_bridgeObjectRelease(array);

    return str;
}


let swiftValueProxy = {
    get(obj, property) {
        if (property === 'toString') {
            return () => swiftToString(new Proxy(obj, this));
        }

        if (Reflect.has(obj, property)) {
            return obj[property];
        }

        if (property === '$enumCase') {
            if (!('enumCases' in obj.$type)) {
                throw Error("not an enum");
            }
            let enumCases = type.enumCases();
            if (enumCases.length === 0) {
                return null;
            } else if (enumCases.length === 1) {
                return enumCases[0].name;
            } else {
                let numPayloads = obj.$type.nominalType.enum_.getNumPayloadCases();
                let tag;
                if (numPayloads === 0) {
                    // a C-like enum: an integer just large enough to represent all cases
                    if (enumCases.length < (1 << 8))
                        tag = Memory.readU8(obj.$pointer);
                    else if (enumCases.length < (1 << 16))
                        tag = Memory.readU16(obj.$pointer);
                    else if (enumCases.length < (1 << 32))
                        tag = Memory.readU32(obj.$pointer);
                    else if (enumCases.length < (1 << 64))
                        tag = Memory.readU64(obj.$pointer);
                    else
                        throw Error("impossibly large number of enum cases");
                } else if (numPayloads === 1) {
                    // single-payload enum: tag is after the value, or in spare bits if available
                    let opaqueVal = obj.$pointer;
                    tag = Swift._api.swift_getEnumCaseSinglePayload(opaqueVal, enumCases[0].type, enumCases.length);
                } else {
                    // multi-payload enum:
                    // - all non-payload cases are collapsed into a single tag, secondary tag to
                    //   differentiate them is stored in place of value
                    // - tag is stored in spare bits shared by all values
                    // - all remaining bits of tag (that don't fit in spare bits) are appended to the value
                    let opaqueVal = obj.$pointer;
                    tag = Swift._api.swift_getEnumCaseMultiPayload(opaqueVal, obj.$type.nominalType._ptr);
                }
                return enumCases[tag];
            }
        }

        if (obj.$type.kind === "Class" || (obj.$type.kind === "Existential" && obj.$type.getRepresentation() === "Class")) {
            if (property === "$isa")
                return Memory.readPointer(Memory.readPointer(obj.$pointer).add(0));
            if (property === "$isaClass")
                return ObjC.api.object_getClass(Memory.readPointer(obj.$pointer).add(0)); // TODO: return Type object
            if (property === "$retainCounts")
                return Memory.readPointer(Memory.readPointer(obj.$pointer).add(Process.pointerSize));
        }

        if ("fields" in obj.$type) {
            if (!("_$fields" in obj))
                obj._$fields = obj.$type.fields();
            let field = null;
            for (let f of obj._$fields) {
                if (f.name === property) {
                    field = f;
                    break;
                }
            }
            if (field) {

                // TODO: check indirect/weak flags
                let addr;
                if (obj.$type.kind === "Struct")
                    addr = obj.$pointer.add(field.offset);
                else
                    // TODO: need to dereference here
                    addr = obj.$pointer.add(field.offset);

                if ("toJS" in field.type) {
                    let val = field.type.toJS(addr);
                    if (val !== undefined)
                        return val;
                }
                return new field.type(addr);
            }
        }

        if ("$tupleElements" in obj.$type) {
            if (!("_$tupleElements" in obj)) {
                obj._$tupleElements = new Map();
                let cnt = 0;
                for (let elem of obj.$type.tupleElements()) {
                    let label = elem.label;
                    if (label !== null) {
                        obj._$tupleElements.set(label, elem);
                    }
                    obj._$tupleElements.set(cnt.toString(), elem);
                    cnt++;
                }
            }

            if (obj._$tupleElements.has(property)) {
                let elem = obj._$tupleElements.get(property);
                return new SwiftValue(elem.type, obj.$pointer.add(elem.offset));
            }
        }

        return undefined;
    },

    // note: not all of these functions are supported by Duktape, see https://github.com/svaarala/duktape-wiki/blob/482ab8e1cf96980c43aa598fd4975a9ccaae80b2/HowtoVirtualProperties.md#examples-of-has-get-set-and-deleteproperty-traps
    isExtensible() {
        return false;
    },
    preventExtensions(_) {
        return true;
    },
    getPrototypeOf(target) {
        return target.$type;
    },
    setPrototypeOf(_) {
        throw TypeError("you can't override the prototype of a Swift value");
    },
    has(target, key) {
        if (this.get(target, key) === undefined)
            return false;
        return true;
    },
    ownKeys(target) {
        // TODO
    },
    set(_target, _key, _value, _receiver) {
        return false; // TODO
    },
    defineProperty(target, key, descriptor) {
        if (key.indexOf("$$") === -1)
            throw new Error(`cannot define a new property on a Swift value (use '\$\$${key}' if you must)`);
        return Object.defineProperty(target, key, descriptor);
    },
    deleteProperty(target, key) {
        if (key.indexOf("$$") === -1)
            return false;
        return Object.deleteProperty(target, key);
    },
    getOwnPropertyDescriptor(target, prop) {
        if (this.has(target, prop))
            return { configurable: false, enumerable: true, value: this.get(target, prop) };
        return undefined;
    },
    apply(target, thisArg, argList) {
        if (target.$type.kind !== "Function")
            throw TypeError("this value has a non-function type, so it cannot be called");
        if (thisArg !== undefined)
            throw Error("Swift function type may not be called from a method context");

        let type = target.$type;
        let flags = type.functionFlags;
        if (argList.length < flags.numArguments) {
            throw TypeError("missing arguments: " + flags.numArguments + " arguments required");
        } else if (argList.length > flags.numArguments) {
            throw TypeError("too many arguments: " + flags.numArguments + " arguments required");
        }

        if (flags.doesThrow) {
            throw Error("calling a function that can throw is not yet supported"); // TODO
        }

        switch (flags.convention) {
            case types.FunctionMetadataConvention.Swift:
                throw Error("calling Swift functions not yet supported");
            case types.FunctionMetadataConvention.Block: {
                let block = new ObjC.Block(target.$pointer);
                return block.implementation(...params);
            }
            case types.FunctionMetadataConvention.Thin:
                throw Error("calling thin functions not yet supported");
            case types.FunctionMetadataConvention.CFunctionPointer: {
                let params = [];
                let fridaTypes = [];
                let argTypes = type.getArguments();

                function convertType(swiftType, swiftOrJSVal) {
                    let fridaType, jsVal;
                    switch (argType.toString()) {
                        case "Swift.Int8":
                            fridaType = "int8";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readS8(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.UInt8":
                            fridaType = "uint8";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readU8(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.Int16":
                            fridaType = "int16";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readS16(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.UInt16":
                            fridaType = "uint16";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readU16(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.Int32":
                            fridaType = "int32";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readS32(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.UInt32":
                            fridaType = "uint32";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readU32(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.Int64":
                            fridaType = "int64";
                            if (swiftOrJSVal instanceof Int64) {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readS64(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.UInt64":
                            fridaType = "uint64";
                            if (swiftOrJSVal instanceof UInt64) {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readU64(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.Double":
                            fridaType = "double";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readDouble(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "Swift.Float":
                            fridaType = "float";
                            if (typeof swiftOrJSVal === "number") {
                                jsVal = swiftOrJSVal;
                            } else if (jsVal !== undefined) {
                                jsVal = Memory.readFloat(swiftOrJSVal.$pointer);
                            }
                            break;
                        case "()":
                            fridaType = "void";
                            jsVal = undefined;
                            break;
                        default:
                            if (argType.nominalType && argType.nominalType.mangledName === "_T0SP") {
                                fridaType = "pointer";
                                if (swiftOrJsVal instanceof NativePointer)
                                    jsVal = swiftOrJsVal;
                                else if (jsVal !== undefined)
                                    jsVal = Memory.readPointer(swiftOrJsVal.$pointer);
                            } else {
                                throw Error("don't know how to convert a '" + argType.toString() + "' to a C value!");
                            }
                    }

                    return { fridaType: fridaType, jsVal: jsVal };
                }

                for (let i = 0; i < flags.numArguments; i++) {
                    let res = convertType(argTypes[i], argList[i]);
                    if (res.jsVal === undefined && res.fridaType !== "void") {
                        throw Error("argument " + i + " must not be undefined");
                    }
                    fridaTypes.push(res.fridaType);
                    params.push(res.jsVal);
                }

                let returnType = convertType(type.returnType, undefined);
                let func = new NativeFunction(Memory.readPointer(target.$pointer), returnType, fridaTypes);
                return func(...params);
            }
        }
    },
};

function makeSwiftValue(type) {
    if (!type.canonicalType) {
        throw Error("the type of a value must have a canonical type descriptor!");
    }

    let SwiftValue = function (pointer) {
        this.$type = type;
        this.$pointer = pointer;

        return new Proxy(this, swiftValueProxy);
    };
    Reflect.defineProperty(SwiftValue, 'name', { value: type.toString() });

    return SwiftValue;
}

module.exports = {
    makeSwiftValue: makeSwiftValue,
};

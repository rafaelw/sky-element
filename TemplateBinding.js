/*
<!--
// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
-->
<import src="observe.sky" as="observe" />

<script>

// observe.* imports into local namespace
var Path = observe.Path;
var PathObserver = observe.PathObserver;
var ObserverTransform = observe.ObserverTransform;
var CompoundObserver = observe.CompoundObserver;
var ArrayObserver = observe.ArrayObserver;

*/

var isSky = typeof Node.DOCUMENT_NODE == 'undefined';

Node.prototype.bind = function(name, observable, oneTime) {
  var self = this;

  if (oneTime) {
    this[name] = observable;
    return;
  }

  observable.open(function(value) {
    self[name] = value;
  });

  return observable;
};

function sanitizeValue(value) {
  return value == null ? '' : value;
}

function updateText(node, value) {
  node.data = sanitizeValue(value);
}

function textBinding(node) {
  return function(value) {
    return updateText(node, value);
  };
}

Text.prototype.bind = function(name, value, oneTime) {
  if (name !== 'textContent')
    return Node.prototype.bind.call(this, name, value, oneTime);

  if (oneTime)
    return updateText(this, value);

  var observable = value;
  updateText(this, observable.open(textBinding(this)));
  return observable;
}

function updateAttribute(el, name, value) {
  el.setAttribute(name, sanitizeValue(value));
}

function attributeBinding(el, name) {
  return function(value) {
    updateAttribute(el, name, value);
  };
}

function bindAsAttribute(el, name) {
  if (name == 'style' || name == 'class')
    return true;
  if (el.tagName == 'a' && name == 'href')
    return true;
}

Element.prototype.bind = function(name, value, oneTime) {
  if (!bindAsAttribute(this, name))
    return Node.prototype.bind.call(this, name, value, oneTime);

  if (oneTime)
    return updateAttribute(this, name, value);

  var observable = value;
  updateAttribute(this, name, observable.open(attributeBinding(this, name)));
  return observable;
}

function getFragmentRoot(node) {
  var p;
  while (p = node.parentNode) {
    node = p;
  }

  return node;
}

function searchRefId(node, id) {
  if (!id)
    return;

  var ref;
  var selector = '#' + id;
  while (!ref) {
    node = getFragmentRoot(node);

    if (node.protoContent_)
      ref = node.protoContent_.querySelector(selector);
    else if (node.getElementById)
      ref = node.getElementById(id);

    if (ref || !node.templateCreator_)
      break

    node = node.templateCreator_;
  }

  return ref;
}

function getInstanceRoot(node) {
  while (node.parentNode) {
    node = node.parentNode;
  }
  return node.templateCreator_ ? node : null;
}

var BIND = 'bind';
var REPEAT = 'repeat';
var IF = 'if';

var templateAttributeDirectives = {
  'template': true,
  'repeat': true,
  'bind': true,
  'ref': true
};

function isTemplate(el) {
  if (el.isTemplate_ === undefined)
    el.isTemplate_ = el.tagName == 'template';

  return el.isTemplate_;
}

function mixin(to, from) {
  Object.getOwnPropertyNames(from).forEach(function(name) {
    Object.defineProperty(to, name,
                          Object.getOwnPropertyDescriptor(from, name));
  });
}

function X_newStagingDocument(owner) {
  return isSky ? new Document() : owner.implementation.createHTMLDocument('');
}

function getTemplateStagingDocument(template) {
  if (!template.stagingDocument_) {
    var owner = template.ownerDocument;
    if (!owner.stagingDocument_) {
      // FIXME(sky): Does this need to create a Document without a registration
      // context?
      owner.stagingDocument_ = X_newStagingDocument(owner);
      owner.stagingDocument_.isStagingDocument = true;
      owner.stagingDocument_.stagingDocument_ = owner.stagingDocument_;
    }

    template.stagingDocument_ = owner.stagingDocument_;
  }

  return template.stagingDocument_;
}

var templateObserver;
if (typeof MutationObserver == 'function') {
  templateObserver = new MutationObserver(function(records) {
    for (var i = 0; i < records.length; i++) {
      records[i].target.refChanged_();
    }
  });
}

var contentDescriptor = {
  get: function() {
    return this.content_;
  },
  enumerable: true,
  configurable: true
};

function ensureSetModelScheduled(template) {
  if (!template.setModelFn_) {
    template.setModelFn_ = function() {
      template.setModelFnScheduled_ = false;
      var map = getBindings(template);
      processBindings(template, map, template.model_);
    };
  }

  if (!template.setModelFnScheduled_) {
    template.setModelFnScheduled_ = true;
    Promise.resolve().then(template.setModelFn_);
  }
}

mixin(HTMLTemplateElement.prototype, {
  bind: function(name, value, oneTime) {
    if (name != 'ref')
      return Element.prototype.bind.call(this, name, value, oneTime);

    var self = this;
    var ref = oneTime ? value : value.open(function(ref) {
      self.setAttribute('ref', ref);
      self.refChanged_();
    });

    this.setAttribute('ref', ref);
    this.refChanged_();
    if (oneTime)
      return;

    if (!this.bindings_) {
      this.bindings_ = { ref: value };
    } else {
      this.bindings_.ref = value;
    }

    return value;
  },

  processBindingDirectives_: function(directives) {
    if (this.iterator_)
      this.iterator_.closeDeps();

    if (!directives.if && !directives.bind && !directives.repeat) {
      if (this.iterator_) {
        this.iterator_.close();
        this.iterator_ = undefined;
      }

      return;
    }

    if (!this.iterator_) {
      this.iterator_ = new TemplateIterator(this);
    }

    this.iterator_.updateDependencies(directives, this.model_);

    if (templateObserver) {
      templateObserver.observe(this, { attributes: true,
                                       attributeFilter: ['ref'] });
    }

    return this.iterator_;
  },

  createInstance: function(model, bindingDelegate, delegate_) {
    if (bindingDelegate)
      delegate_ = this.newDelegate_(bindingDelegate);
    else if (!delegate_)
      delegate_ = this.delegate_;

    if (!this.refContent_)
      this.refContent_ = this.ref_.content;
    var content = this.refContent_;
    if (content.firstChild === null)
      return emptyInstance;

    var map = getInstanceBindingMap(content);
    var stagingDocument = getTemplateStagingDocument(this);
    var instance = stagingDocument.createDocumentFragment();
    instance.templateCreator_ = this;
    instance.protoContent_ = content;
    instance.bindings_ = [];
    instance.terminator_ = null;
    var instanceRecord = instance.templateInstance_ = {
      firstNode: null,
      lastNode: null,
      model: model
    };

    var i = 0;
    var collectTerminator = false;
    for (var child = content.firstChild; child; child = child.nextSibling) {
      // The terminator of the instance is the clone of the last child of the
      // content. If the last child is an active template, it may produce
      // instances as a result of production, so simply collecting the last
      // child of the instance after it has finished producing may be wrong.
      if (child.nextSibling === null)
        collectTerminator = true;

      var clone = cloneAndBindInstance(child, instance, stagingDocument,
                                       map.children[i++],
                                       model,
                                       delegate_,
                                       instance.bindings_);
      clone.templateInstance_ = instanceRecord;
      if (collectTerminator)
        instance.terminator_ = clone;
    }

    instanceRecord.firstNode = instance.firstChild;
    instanceRecord.lastNode = instance.lastChild;
    instance.templateCreator_ = undefined;
    instance.protoContent_ = undefined;
    return instance;
  },

  get model() {
    return this.model_;
  },

  set model(model) {
    this.model_ = model;
    ensureSetModelScheduled(this);
  },

  get bindingDelegate() {
    return this.delegate_ && this.delegate_.raw;
  },

  refChanged_: function() {
    if (!this.iterator_ || this.refContent_ === this.ref_.content)
      return;

    this.refContent_ = undefined;
    this.iterator_.valueChanged();
    this.iterator_.updateIteratedValue(this.iterator_.getUpdatedValue());
  },

  clear: function() {
    this.model_ = undefined;
    this.delegate_ = undefined;
    if (this.bindings_ && this.bindings_.ref)
      this.bindings_.ref.close()
    this.refContent_ = undefined;
    if (!this.iterator_)
      return;
    this.iterator_.valueChanged();
    this.iterator_.close()
    this.iterator_ = undefined;
  },

  setDelegate_: function(delegate) {
    this.delegate_ = delegate;
    this.bindingMap_ = undefined;
    if (this.iterator_) {
      this.iterator_.instancePositionChangedFn_ = undefined;
      this.iterator_.instanceModelFn_ = undefined;
    }
  },

  newDelegate_: function(bindingDelegate) {
    if (!bindingDelegate)
      return;

    function delegateFn(name) {
      var fn = bindingDelegate && bindingDelegate[name];
      if (typeof fn != 'function')
        return;

      return function() {
        return fn.apply(bindingDelegate, arguments);
      };
    }

    return {
      raw: bindingDelegate,
      prepareInstanceModel: delegateFn('prepareInstanceModel'),
      prepareInstancePositionChanged:
          delegateFn('prepareInstancePositionChanged')
    };
  },

  set bindingDelegate(bindingDelegate) {
    if (this.delegate_) {
      throw Error('Template must be cleared before a new bindingDelegate ' +
                  'can be assigned');
    }

    this.setDelegate_(this.newDelegate_(bindingDelegate));
  },

  get ref_() {
    var ref = searchRefId(this, this.getAttribute('ref'));
    if (!ref)
      ref = this.instanceRef_;

    if (!ref)
      return this;

    var nextRef = ref.ref_;
    return nextRef ? nextRef : ref;
  }
});

// Returns
//   a) undefined if there are no mustaches.
//   b) [TEXT, (ONE_TIME?, PATH, DELEGATE_FN, TEXT)+] if there is at least
//      one mustache.
function parseMustaches(s, name, node) {
  if (!s || !s.length)
    return;

  var tokens;
  var length = s.length;
  var startIndex = 0, lastIndex = 0, endIndex = 0;
  var onlyOneTime = true;
  while (lastIndex < length) {
    var startIndex = s.indexOf('{{', lastIndex);
    var oneTimeStart = s.indexOf('[[', lastIndex);
    var oneTime = false;
    var terminator = '}}';

    if (oneTimeStart >= 0 &&
        (startIndex < 0 || oneTimeStart < startIndex)) {
      startIndex = oneTimeStart;
      oneTime = true;
      terminator = ']]';
    }

    endIndex = startIndex < 0 ? -1 : s.indexOf(terminator, startIndex + 2);

    if (endIndex < 0) {
      if (!tokens)
        return;

      tokens.push(s.slice(lastIndex)); // TEXT
      break;
    }

    tokens = tokens || [];
    tokens.push(s.slice(lastIndex, startIndex)); // TEXT
    var pathString = s.slice(startIndex + 2, endIndex).trim();
    tokens.push(oneTime); // ONE_TIME?
    onlyOneTime = onlyOneTime && oneTime;
    tokens.push(Path.get(pathString)); // PATH
    tokens.push(null); // delegate DELEGATE_FN
    lastIndex = endIndex + 2;
  }

  if (lastIndex === length)
    tokens.push(''); // TEXT

  tokens.hasOnePath = tokens.length === 5;
  tokens.isSimplePath = tokens.hasOnePath &&
                        tokens[0] == '' &&
                        tokens[4] == '';
  tokens.onlyOneTime = onlyOneTime;

  tokens.combinator = function(values) {
    var newValue = tokens[0];

    for (var i = 1; i < tokens.length; i += 4) {
      var value = tokens.hasOnePath ? values : values[(i - 1) / 4];
      if (value !== undefined)
        newValue += value;
      newValue += tokens[i + 3];
    }

    return newValue;
  }

  return tokens;
};

function processOneTimeBinding(name, tokens, node, model) {
  if (tokens.hasOnePath) {
    var value = tokens[2].getValueFrom(model);
    return tokens.isSimplePath ? value : tokens.combinator(value);
  }

  var values = [];
  for (var i = 1; i < tokens.length; i += 4) {
    values[(i - 1) / 4] = tokens[i + 1].getValueFrom(model);
  }

  return tokens.combinator(values);
}

function processSinglePathBinding(name, tokens, node, model) {
  var observer = new PathObserver(model, tokens[2]);

  return tokens.isSimplePath ? observer :
      new ObserverTransform(observer, tokens.combinator);
}

function processBinding(name, tokens, node, model) {
  if (tokens.onlyOneTime)
    return processOneTimeBinding(name, tokens, node, model);

  if (tokens.hasOnePath)
    return processSinglePathBinding(name, tokens, node, model);

  var observer = new CompoundObserver();

  for (var i = 1; i < tokens.length; i += 4) {
    var oneTime = tokens[i];
    var path = tokens[i + 1];
    if (oneTime)
      observer.addPath(path.getValueFrom(model))
    else
      observer.addPath(model, path);
  }

  return new ObserverTransform(observer, tokens.combinator);
}

function processBindings(node, bindings, model, instanceBindings) {
  for (var i = 0; i < bindings.length; i += 2) {
    var name = bindings[i]
    var tokens = bindings[i + 1];
    var value = processBinding(name, tokens, node, model);
    var binding = node.bind(name, value, tokens.onlyOneTime);
    if (binding && instanceBindings)
      instanceBindings.push(binding);
  }

  if (!bindings.isTemplate)
    return;

  node.model_ = model;
  var iter = node.processBindingDirectives_(bindings);
  if (instanceBindings && iter)
    instanceBindings.push(iter);
}

function parseWithDefault(el, name) {
  var v = el.getAttribute(name);
  return parseMustaches(v == '' ? '{{}}' : v, name, el);
}

function parseAttributeBindings(element) {
  var bindings = [];
  var ifFound = false;
  var bindFound = false;
  var attributes = element.getAttributes();

  for (var i = 0; i < attributes.length; i++) {
    var attr = attributes[i];
    var name = attr.name;
    var value = attr.value;

    if (isTemplate(element) &&
        (name === IF || name === BIND || name === REPEAT)) {
      continue;
    }

    var tokens = parseMustaches(value, name, element);
    if (!tokens)
      continue;

    bindings.push(name, tokens);
  }

  if (isTemplate(element)) {
    bindings.isTemplate = true;
    bindings.if = parseWithDefault(element, IF);
    bindings.bind = parseWithDefault(element, BIND);
    bindings.repeat = parseWithDefault(element, REPEAT);

    if (bindings.if && !bindings.bind && !bindings.repeat)
      bindings.bind = parseMustaches('{{}}', BIND, element);
  }

  return bindings;
}

function getBindings(node) {
  if (node instanceof Element) {
    return parseAttributeBindings(node);
  }

  if (node instanceof Text) {
    var tokens = parseMustaches(node.data, 'textContent', node);
    if (tokens)
      return ['textContent', tokens];
  }

  return [];
}

function cloneAndBindInstance(node, parent, stagingDocument, bindings, model,
                              delegate,
                              instanceBindings,
                              instanceRecord) {
  var clone = parent.appendChild(stagingDocument.importNode(node, false));

  var i = 0;
  for (var child = node.firstChild; child; child = child.nextSibling) {
    cloneAndBindInstance(child, clone, stagingDocument,
                          bindings.children[i++],
                          model,
                          delegate,
                          instanceBindings);
  }

  if (bindings.isTemplate) {
    clone.instanceRef_ = node;

    if (delegate)
      clone.setDelegate_(delegate);
  }

  processBindings(clone, bindings, model, instanceBindings);
  return clone;
}

function createInstanceBindingMap(node) {
  var map = getBindings(node);
  map.children = {};
  var index = 0;
  for (var child = node.firstChild; child; child = child.nextSibling) {
    map.children[index++] = createInstanceBindingMap(child);
  }

  return map;
}

// TODO(rafaelw): Separate out the parse map from the binding map. In the
// current implementation, if two delegates need a binding map for the same
// content, the second will have to reparse.
function getInstanceBindingMap(content) {
  var map = content.bindingMap_;
  if (!map) {
    map = content.bindingMap_ =
        createInstanceBindingMap(content) || [];
  }
  return map;
}

Object.defineProperty(Node.prototype, 'templateInstance', {
  get: function() {
    var instance = this.templateInstance_;
    return instance ? instance :
        (this.parentNode ? this.parentNode.templateInstance : undefined);
  }
});

var emptyInstance = document.createDocumentFragment();
emptyInstance.bindings_ = [];
emptyInstance.terminator_ = null;

function TemplateIterator(templateElement) {
  this.closed = false;
  this.templateElement_ = templateElement;
  this.instances = [];
  this.deps = undefined;
  this.iteratedValue = [];
  this.presentValue = undefined;
  this.arrayObserver = undefined;
}

TemplateIterator.prototype = {
  closeDeps: function() {
    var deps = this.deps;
    if (deps) {
      if (deps.ifOneTime === false)
        deps.ifValue.close();
      if (deps.oneTime === false)
        deps.value.close();
    }
  },

  updateDependencies: function(directives, model) {
    this.closeDeps();

    var deps = this.deps = {};
    var template = this.templateElement_;

    var ifValue = true;
    if (directives.if) {
      deps.hasIf = true;
      deps.ifOneTime = directives.if.onlyOneTime;
      deps.ifValue = processBinding(IF, directives.if, template, model);

      ifValue = deps.ifValue;

      // oneTime if & predicate is false. nothing else to do.
      if (deps.ifOneTime && !ifValue) {
        this.valueChanged();
        return;
      }

      if (!deps.ifOneTime)
        ifValue = ifValue.open(this.updateIfValue, this);
    }

    if (directives.repeat) {
      deps.repeat = true;
      deps.oneTime = directives.repeat.onlyOneTime;
      deps.value = processBinding(REPEAT, directives.repeat, template, model);
    } else {
      deps.repeat = false;
      deps.oneTime = directives.bind.onlyOneTime;
      deps.value = processBinding(BIND, directives.bind, template, model);
    }

    var value = deps.value;
    if (!deps.oneTime)
      value = value.open(this.updateIteratedValue, this);

    if (!ifValue) {
      this.valueChanged();
      return;
    }

    this.updateValue(value);
  },

  /**
   * Gets the updated value of the bind/repeat. This can potentially call
   * user code (if a bindingDelegate is set up) so we try to avoid it if we
   * already have the value in hand (from Observer.open).
   */
  getUpdatedValue: function() {
    var value = this.deps.value;
    if (!this.deps.oneTime)
      value = value.discardChanges();
    return value;
  },

  updateIfValue: function(ifValue) {
    if (!ifValue) {
      this.valueChanged();
      return;
    }

    this.updateValue(this.getUpdatedValue());
  },

  updateIteratedValue: function(value) {
    if (this.deps.hasIf) {
      var ifValue = this.deps.ifValue;
      if (!this.deps.ifOneTime)
        ifValue = ifValue.discardChanges();
      if (!ifValue) {
        this.valueChanged();
        return;
      }
    }

    this.updateValue(value);
  },

  updateValue: function(value) {
    if (!this.deps.repeat)
      value = [value];
    var observe = this.deps.repeat &&
                  !this.deps.oneTime &&
                  Array.isArray(value);
    this.valueChanged(value, observe);
  },

  valueChanged: function(value, observeValue) {
    if (!Array.isArray(value))
      value = [];

    if (value === this.iteratedValue)
      return;

    this.unobserve();
    this.presentValue = value;
    if (observeValue) {
      this.arrayObserver = new ArrayObserver(this.presentValue);
      this.arrayObserver.open(this.handleSplices, this);
    }

    this.handleSplices(ArrayObserver.calculateSplices(this.presentValue,
                                                      this.iteratedValue));
  },

  getLastInstanceNode: function(index) {
    if (index == -1)
      return this.templateElement_;
    var instance = this.instances[index];
    var terminator = instance.terminator_;
    if (!terminator)
      return this.getLastInstanceNode(index - 1);

    if (terminator.nodeType !== Node.ELEMENT_NODE ||
        this.templateElement_ === terminator) {
      return terminator;
    }

    var subtemplateIterator = terminator.iterator_;
    if (!subtemplateIterator)
      return terminator;

    return subtemplateIterator.getLastTemplateNode();
  },

  getLastTemplateNode: function() {
    return this.getLastInstanceNode(this.instances.length - 1);
  },

  insertInstanceAt: function(index, fragment) {
    var previousInstanceLast = this.getLastInstanceNode(index - 1);
    var parent = this.templateElement_.parentNode;
    this.instances.splice(index, 0, fragment);

    parent.insertBefore(fragment, previousInstanceLast.nextSibling);
  },

  extractInstanceAt: function(index) {
    var previousInstanceLast = this.getLastInstanceNode(index - 1);
    var lastNode = this.getLastInstanceNode(index);
    var parent = this.templateElement_.parentNode;
    var instance = this.instances.splice(index, 1)[0];

    while (lastNode !== previousInstanceLast) {
      var node = previousInstanceLast.nextSibling;
      if (node == lastNode)
        lastNode = previousInstanceLast;

      instance.appendChild(parent.removeChild(node));
    }

    return instance;
  },

  getDelegateFn: function(fn) {
    fn = fn && fn(this.templateElement_);
    return typeof fn === 'function' ? fn : null;
  },

  handleSplices: function(splices) {
    if (this.closed || !splices.length)
      return;

    var template = this.templateElement_;

    if (!template.parentNode) {
      this.close();
      return;
    }

    ArrayObserver.applySplices(this.iteratedValue, this.presentValue,
                               splices);

    var delegate = template.delegate_;
    if (this.instanceModelFn_ === undefined) {
      this.instanceModelFn_ =
          this.getDelegateFn(delegate && delegate.prepareInstanceModel);
    }

    if (this.instancePositionChangedFn_ === undefined) {
      this.instancePositionChangedFn_ =
          this.getDelegateFn(delegate &&
                             delegate.prepareInstancePositionChanged);
    }

    // Instance Removals
    var instanceCache = new Map;
    var removeDelta = 0;
    for (var i = 0; i < splices.length; i++) {
      var splice = splices[i];
      var removed = splice.removed;
      for (var j = 0; j < removed.length; j++) {
        var model = removed[j];
        var instance = this.extractInstanceAt(splice.index + removeDelta);
        if (instance !== emptyInstance) {
          instanceCache.set(model, instance);
        }
      }

      removeDelta -= splice.addedCount;
    }

    // Instance Insertions
    for (var i = 0; i < splices.length; i++) {
      var splice = splices[i];
      var addIndex = splice.index;
      for (; addIndex < splice.index + splice.addedCount; addIndex++) {
        var model = this.iteratedValue[addIndex];
        var instance = instanceCache.get(model);
        if (instance) {
          instanceCache.delete(model);
        } else {
          if (this.instanceModelFn_) {
            model = this.instanceModelFn_(model);
          }

          if (model === undefined) {
            instance = emptyInstance;
          } else {
            instance = template.createInstance(model, undefined, delegate);
          }
        }

        this.insertInstanceAt(addIndex, instance);
      }
    }

    instanceCache.forEach(function(instance) {
      this.closeInstanceBindings(instance);
    }, this);

    if (this.instancePositionChangedFn_)
      this.reportInstancesMoved(splices);
  },

  reportInstanceMoved: function(index) {
    var instance = this.instances[index];
    if (instance === emptyInstance)
      return;

    this.instancePositionChangedFn_(instance.templateInstance_, index);
  },

  reportInstancesMoved: function(splices) {
    var index = 0;
    var offset = 0;
    for (var i = 0; i < splices.length; i++) {
      var splice = splices[i];
      if (offset != 0) {
        while (index < splice.index) {
          this.reportInstanceMoved(index);
          index++;
        }
      } else {
        index = splice.index;
      }

      while (index < splice.index + splice.addedCount) {
        this.reportInstanceMoved(index);
        index++;
      }

      offset += splice.addedCount - splice.removed.length;
    }

    if (offset == 0)
      return;

    var length = this.instances.length;
    while (index < length) {
      this.reportInstanceMoved(index);
      index++;
    }
  },

  closeInstanceBindings: function(instance) {
    var bindings = instance.bindings_;
    for (var i = 0; i < bindings.length; i++) {
      bindings[i].close();
    }
  },

  unobserve: function() {
    if (!this.arrayObserver)
      return;

    this.arrayObserver.close();
    this.arrayObserver = undefined;
  },

  close: function() {
    if (this.closed)
      return;
    this.unobserve();
    for (var i = 0; i < this.instances.length; i++) {
      this.closeInstanceBindings(this.instances[i]);
    }

    this.instances.length = 0;
    this.closeDeps();
    this.templateElement_.iterator_ = undefined;
    this.closed = true;
  }
};
/*
</script>

*/

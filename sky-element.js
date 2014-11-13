/*
<!--
// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
-->
<import src="TemplateBinding.sky" />
<script>
*/

var templates = new Map();

function createPrototype(proto, definition) {
  var result = Object.create(proto);
  var names = Object.getOwnPropertyNames(definition);
  for (var i = 0; i < names.length; ++i) {
    var descriptor = Object.getOwnPropertyDescriptor(definition, names[i]);
    Object.defineProperty(result, names[i], descriptor);
  }
  return result;
}

var BasePrototype = createPrototype(HTMLElement.prototype, {

  createdCallback: function() {
    this.created();
  },

  created: function() {
    // override
  },

  attachedCallback: function() {
    if (!this.shadowRoot) {
      var template = templates.get(this.localName);
      if (template) {
        var shadow = this.createShadowRoot();
        shadow.appendChild(template.createInstance(this));
      }
    }
    this.attached();
  },

  attached: function() {
    // override
  },

  dettachedCallback: function() {
    this.dettached();
  },

  dettached: function() {
    // override
  },

  attributeChangedCallback: function(attrName, oldValue, newValue) {
    // reserved for canonical behavior
    this.attributeChanged(attrName, oldValue, newValue);
  },

  attributeChanged: function(attrName, oldValue, newValue) {
    // override
  }
});

function SkyElement(prototype) {
  var template = document.currentScript.previousElementSibling;
  if (template && template.localName === 'template')
    templates.set(prototype.name, template);

  document.registerElement(prototype.name, {
    prototype: createPrototype(BasePrototype, prototype),
  });
};

/*
module.exports = SkyElement;
</script>

*/
